-- Tiger Data telemetry aggregates (owner: D). Apply after schema.sql. Idempotent.
-- Event shapes: C's telemetry SDK (apps/web/lib/telemetry). Every payload has t = ms since session start.
--
-- Design notes
-- * Behaviour beats fingerprints. A CDP-driven Chrome looked human to trusted/webdriver/BotD; the tells were
--   clicks with no pointer movement before them, and (from A's browser-use runs) answers set through JS with
--   zero input events. Flags are kept, but only as weak signals.
-- * One continuous aggregate at 1-minute grain per (attempt, item) holds rollup-able Toolkit aggregates:
--   stats_agg (key timing), state_agg (focus state), heartbeat_agg (human input liveness).
--   Views roll those up per attempt/item and per attempt for the dashboard and the model.
-- * Sequence features (click without move, answer without input) need event order, so they are plain views
--   over the raw hypertable. Fine at hackathon volume.
-- * Nothing here is a verdict. These are features and evidence for a professor.

create extension if not exists timescaledb_toolkit;

-- Events that only a person at the keyboard/mouse produces.
create or replace function is_human_input(kind text, payload jsonb) returns boolean
language sql immutable parallel safe as $$
  select kind in ('key', 'paste', 'scroll', 'select')
      or (kind = 'pointer' and coalesce(payload->>'type', '') in ('move', 'down', 'click'))
$$;

-- 1. Per attempt, per item, per minute ------------------------------------------------------------------
create materialized view if not exists ie_item_1m
with (timescaledb.continuous, timescaledb.materialized_only = false) as
select
  time_bucket('1 minute', ts) as bucket,
  attempt_id,
  coalesce(item_id, '') as item_id,
  count(*) filter (where kind = 'key') as keys,
  stats_agg((payload->>'dt')::double precision)
    filter (where kind = 'key' and payload->>'dt' is not null and (payload->>'dt')::double precision < 5000) as key_dt,
  count(*) filter (where kind = 'key' and payload->>'cls' = 'delete') as deletes,
  count(*) filter (where kind = 'paste') as pastes,
  coalesce(sum((payload->>'length')::int) filter (where kind = 'paste'), 0) as paste_chars,
  count(*) filter (where kind = 'pointer' and payload->>'type' = 'click') as clicks,
  coalesce(sum(jsonb_array_length(payload->'points')) filter (where kind = 'pointer' and payload->>'type' = 'move'), 0) as move_points,
  count(*) filter (where kind = 'scroll') as scrolls,
  count(*) filter (where kind = 'blur') as blurs,
  count(*) filter (where kind = 'answer' and payload->>'type' = 'change') as answer_changes,
  count(*) filter (where kind = 'answer' and payload->>'type' = 'submit') as submits,
  count(*) filter (where (kind in ('key', 'pointer', 'paste', 'select')) and payload->>'trusted' = 'false') as untrusted,
  -- Focus state over time; focus/blur rows are the transitions.
  state_agg(ts, case when kind = 'blur' then 'away' else 'here' end)
    filter (where kind in ('focus', 'blur') and coalesce(payload->>'type', '') not in ('session_start', 'botd')) as focus_state,
  -- Liveness of human input: a gap > 3 s with no input is a dead range.
  heartbeat_agg(ts, time_bucket('1 minute', ts), '1 minute', '3 seconds')
    filter (where is_human_input(kind, payload)) as human_liveness
from interaction_events
group by 1, 2, 3
with no data;

do $$
begin
  perform add_continuous_aggregate_policy('ie_item_1m',
    start_offset => interval '30 days', end_offset => interval '1 minute', schedule_interval => interval '1 minute');
exception when duplicate_object then null;
  when others then if sqlerrm not like '%already exists%' then raise; end if;
end $$;

-- 2. Sequence features over raw events ------------------------------------------------------------------

-- Clicks with no pointer movement in the previous 1.5 s of the same attempt (synthetic/CDP clicks).
create or replace view click_without_move as
select e.attempt_id, coalesce(e.item_id, '') as item_id, e.ts,
       (select max(m.ts) from interaction_events m
         where m.attempt_id = e.attempt_id and m.kind = 'pointer' and m.payload->>'type' = 'move'
           and m.ts <= e.ts and m.ts > e.ts - interval '1.5 seconds') as last_move
from interaction_events e
where e.kind = 'pointer' and e.payload->>'type' = 'click';

-- Every answer change/submit with the time since the last human input in that attempt.
-- No input at all before an answer, or a long silence, means the answer appeared without a person typing or clicking.
create or replace view answer_input_gap as
select a.attempt_id, coalesce(a.item_id, '') as item_id, a.ts, a.payload->>'type' as answer_type,
       (select max(h.ts) from interaction_events h
         where h.attempt_id = a.attempt_id and h.ts <= a.ts and is_human_input(h.kind, h.payload)) as last_input,
       (select count(*) from interaction_events h
         where h.attempt_id = a.attempt_id and coalesce(h.item_id, '') = coalesce(a.item_id, '')
           and h.ts <= a.ts and is_human_input(h.kind, h.payload)) as item_inputs_before
from interaction_events a
where a.kind = 'answer' and a.payload->>'type' in ('change', 'submit');

-- Weak signals from the session_start / botd rows.
create or replace view session_flags as
select attempt_id,
       bool_or((payload->>'webdriver')::boolean) filter (where payload->>'type' = 'session_start') as webdriver,
       bool_or((payload->>'bot')::boolean) filter (where payload->>'type' = 'botd') as botd_bot,
       max(payload->>'botKind') filter (where payload->>'type' = 'botd') as botd_kind,
       max((payload->>'hardwareConcurrency')::int) filter (where payload->>'type' = 'session_start') as hw_concurrency
from interaction_events
where kind = 'focus' and payload->>'type' in ('session_start', 'botd')
group by attempt_id;

-- 3. Per attempt + item features (dashboard evidence and model input) -----------------------------------
create or replace view attempt_item_features as
with roll as (
  select attempt_id, item_id,
         min(bucket) as first_bucket,
         sum(keys) as keys, rollup(key_dt) as key_dt, sum(deletes) as deletes,
         sum(pastes) as pastes, sum(paste_chars) as paste_chars,
         sum(clicks) as clicks, sum(move_points) as move_points, sum(scrolls) as scrolls,
         sum(blurs) as blurs, sum(answer_changes) as answer_changes, sum(submits) as submits,
         sum(untrusted) as untrusted,
         rollup(focus_state) as focus_state
  from ie_item_1m
  group by attempt_id, item_id
),
cwm as (
  select attempt_id, item_id, count(*) as clicks_total, count(*) filter (where last_move is null) as clicks_no_move
  from click_without_move group by 1, 2
),
aig as (
  select attempt_id, item_id,
         count(*) as answers,
         count(*) filter (where last_input is null or ts - last_input > interval '3 seconds') as answers_in_dead_range,
         count(*) filter (where item_inputs_before = 0) as answers_without_item_input
  from answer_input_gap group by 1, 2
)
select r.attempt_id, r.item_id,
       r.keys, r.deletes, r.pastes, r.paste_chars, r.clicks, r.move_points, r.scrolls, r.blurs,
       r.answer_changes, r.submits, r.untrusted,
       case when r.keys > 1 then average(r.key_dt) end as key_dt_mean_ms,
       case when r.keys > 2 then stddev(r.key_dt) end as key_dt_sd_ms,
       case when r.keys > 2 and average(r.key_dt) > 0 then stddev(r.key_dt) / average(r.key_dt) end as key_dt_cv,
       coalesce(extract(epoch from duration_in(r.focus_state, 'away')) * 1000, 0) as ms_away,
       coalesce(c.clicks_no_move, 0) as clicks_no_move,
       case when coalesce(c.clicks_total, 0) > 0 then c.clicks_no_move::float / c.clicks_total end as click_no_move_ratio,
       coalesce(a.answers, 0) as answers,
       coalesce(a.answers_in_dead_range, 0) as answers_in_dead_range,
       coalesce(a.answers_without_item_input, 0) as answers_without_item_input
from roll r
left join cwm c using (attempt_id, item_id)
left join aig a using (attempt_id, item_id);

-- Dead ranges (no human input for > 3 s) per attempt, for the session timeline.
create or replace view attempt_dead_ranges as
select s.attempt_id, d."start" as range_start, d."end" as range_end
from (
  select attempt_id, rollup(human_liveness) as hb
  from ie_item_1m group by attempt_id
) s
cross join lateral dead_ranges(s.hb) d;

-- 4. Per attempt (one row per session) -------------------------------------------------------------------
create or replace view attempt_features as
select f.attempt_id,
       count(*) filter (where f.item_id <> '') as items,
       sum(f.keys) as keys, sum(f.pastes) as pastes, sum(f.paste_chars) as paste_chars,
       sum(f.clicks) as clicks, sum(f.move_points) as move_points,
       sum(f.clicks_no_move) as clicks_no_move,
       case when sum(f.clicks) > 0 then sum(f.clicks_no_move)::float / sum(f.clicks) end as click_no_move_ratio,
       sum(f.answers) as answers,
       sum(f.answers_in_dead_range) as answers_in_dead_range,
       sum(f.answers_without_item_input) as answers_without_item_input,
       case when sum(f.answers) > 0 then sum(f.answers_without_item_input)::float / sum(f.answers) end as answer_no_input_ratio,
       avg(f.key_dt_cv) as key_dt_cv,
       sum(f.ms_away) as ms_away,
       sum(f.untrusted) as untrusted,
       s.webdriver, s.botd_bot, s.botd_kind
from attempt_item_features f
left join session_flags s using (attempt_id)
group by f.attempt_id, s.webdriver, s.botd_bot, s.botd_kind;

-- 5. Probe timing: counterfactual latency (prompt end -> speech start) -----------------------------------
create or replace view probe_latency as
select probe_id,
       max(ts) filter (where phase = 'cf_prompt') as cf_prompt_at,
       min(ts) filter (where phase = 'cf_speech_start') as cf_speech_at,
       extract(epoch from (min(ts) filter (where phase = 'cf_speech_start') - max(ts) filter (where phase = 'cf_prompt'))) * 1000 as cf_latency_ms
from probe_timing
group by probe_id;
