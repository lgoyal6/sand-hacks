-- Neon Postgres app schema (build plan section 3.2). Owner of changes: B (coordinate in docs/CONTRACTS.md).
create table if not exists course (id text primary key, lti_context_id text, title text not null);
create table if not exists quiz (id text primary key, course_id text references course(id), title text, source_format text, imported_at timestamptz default now());
create table if not exists item (id text primary key, quiz_id text references quiz(id), stem text not null, type text not null, choices_json jsonb, answer_key jsonb, objective text, original_item_id text references item(id));
create table if not exists variant_experiment (id text primary key, item_id text references item(id), neon_branch text, generator text, strategy text, candidate_json jsonb, status text check (status in ('proposed','verified','rejected','approved')), reasons_json jsonb default '[]');
create table if not exists agent_run (id text primary key, quiz_id text, item_id text, agent text, model text, correct boolean, seconds real, steps int, run_at timestamptz default now());
create table if not exists leak_finding (id text primary key, item_id text references item(id), query text, url text, source_type text, snippet text, screenshot_url text, found_at timestamptz default now(), match_score real);
create table if not exists attempt (id text primary key, student_pseudonym text, quiz_id text references quiz(id), mode text check (mode in ('practice','graded')), started_at timestamptz default now(), consent_audio boolean default false);
create table if not exists response (id text primary key, attempt_id text references attempt(id), item_id text references item(id), answer jsonb, correct boolean, seconds real);
create table if not exists probe (id text primary key, attempt_id text references attempt(id), item_id text references item(id), confidence_before int, confidence_after int, transcript text, counterfactual_prompt text, counterfactual_latency_ms int, council_scores_json jsonb, final_score real, professor_approved boolean default false);
create table if not exists session_flag (id text primary key, attempt_id text references attempt(id), agent_likelihood real, top_features_json jsonb);
-- B: each experiment points at the candidate item it wrote on its branch, so merge copies exactly that item.
alter table variant_experiment add column if not exists candidate_item_id text references item(id);
alter table variant_experiment add column if not exists checks_json jsonb default '{}';
alter table variant_experiment add column if not exists created_at timestamptz default now();
-- C: attempts, responses and probes live in Neon; each attempt records the quiz version it saw (appeals).
alter table attempt add column if not exists finished_at timestamptz;
alter table attempt add column if not exists user_agent text;
alter table attempt add column if not exists probe_plan jsonb default '[]';        -- server-only policy state
alter table attempt add column if not exists probes_triggered jsonb default '[]';
alter table attempt add column if not exists quiz_version text;          -- sha256 of the items the student saw (stem, choices, key)
alter table attempt add column if not exists quiz_snapshot_lsn pg_lsn;   -- pg_current_wal_lsn() at start: branch from this LSN for an appeal
alter table attempt add column if not exists quiz_snapshot_at timestamptz;
alter table response add column if not exists answered_at timestamptz default now();
alter table probe add column if not exists mode text;
alter table probe add column if not exists created_at timestamptz default now();
alter table probe add column if not exists completed_at timestamptz;
alter table probe add column if not exists explanation text;
alter table probe add column if not exists counterfactual_answer text;
alter table probe add column if not exists counterfactual_source text;
alter table probe add column if not exists counterfactual_model text;
alter table probe add column if not exists conversation_id text;
alter table probe add column if not exists retried boolean default false;
create unique index if not exists response_attempt_item on response (attempt_id, item_id);  -- one response per item; a re-submit upserts
alter table probe add column if not exists counterfactual_latency_source text;  -- 'scribe' | 'vad' | 'typed'
alter table probe add column if not exists scribe_words_json jsonb;             -- compact [{t, s, e, spk}] for the student's answer turns (appeal + judge view)
-- C: roles in the DB instead of an env allowlist (Neon Auth user ids).
create table if not exists user_role (user_id text primary key, role text not null check (role in ('student','professor')));
-- Figure-only items: the PNG (data URL) and its text (server-side only: answer checker, judges, accommodations).
alter table item add column if not exists figure_json jsonb;
-- Learning objective provenance: 'inferred' (guessed at a Canvas import) must be confirmed before a rewrite; 'professor' is confirmed.
alter table item add column if not exists objective_source text;
update item set objective_source = 'inferred' where objective_source is null and original_item_id is null and quiz_id in (select id from quiz where source_format in ('qti', 'canvas_api'));
alter table item add column if not exists figure_text text;
-- C: accessible-version requests per attempt, e.g. [{itemId, kind: "figure_text", at}]
alter table attempt add column if not exists accommodations jsonb default '[]';
-- The quiz students get: in each original's slot, the latest PROFESSOR-APPROVED variant (never merely
-- "verified"), else the original. Approval only happens after merge, so an approved variant's item is on main.
create or replace view delivered_item as
select
  o.quiz_id,
  (regexp_match(o.id, '-q(\d+)$'))[1]::int as slot,
  o.id as original_item_id,
  coalesce(v.id, o.id) as item_id,
  coalesce(v.stem, o.stem) as stem,
  coalesce(v.type, o.type) as type,
  case when v.id is not null then v.choices_json else o.choices_json end as choices_json,
  coalesce(v.answer_key, o.answer_key) as answer_key,
  coalesce(v.objective, o.objective) as objective,
  case when v.id is not null then v.figure_json else o.figure_json end as figure_json,
  case when v.id is not null then v.figure_text else o.figure_text end as figure_text,
  v.id is not null as is_variant
from item o
left join lateral (
  select i.* from variant_experiment e join item i on i.id = e.candidate_item_id
  where e.item_id = o.id and e.status = 'approved' and e.candidate_item_id is not null
    and coalesce(e.strategy, '') <> 'fresh_data'  -- practice variants are never graded replacements
  order by e.created_at desc, e.id desc limit 1
) v on true
where o.original_item_id is null;
-- C: the exact item ids served in an attempt (variants included), next to quiz_version.
alter table attempt add column if not exists delivered_item_ids jsonb default '[]';
-- B: one row per time-travel appeal, so the experiment tree can show these short-lived branches after deletion.
create table if not exists appeal_log (id bigserial primary key, attempt_id text, quiz_id text, branch text, snapshot_lsn text,
  created_at timestamptz default now(), branch_ms int, total_ms int, deleted boolean);
-- C: typing/paste signals per probe textarea (explanation, follow-up); probe.mode is 'voice' | 'typed' | 'accommodation' (no check constraint).
alter table probe add column if not exists explain_signals_json jsonb;
-- C: per-quiz professor setting "Explanations: voice required" (default off).
alter table quiz add column if not exists voice_required boolean not null default false;
-- D/C: full SHA-256 of quizVersionRecord(served quiz) at attempt start, and its Solana devnet anchor (AnchorRecord).
alter table attempt add column if not exists quiz_version_sha256 text;
alter table attempt add column if not exists quiz_version_anchor jsonb;
-- B (for C): only published quizzes appear on the student home; studio imports (Canvas, course site) start unpublished.
alter table quiz add column if not exists published boolean not null default false;
-- B: automatic leak watch. Each finding keeps when we first saw it and when a professor saw the alert
-- (seen_at null = unseen = "new"); each item records its last scan, so a question is searched at most once a day.
alter table leak_finding add column if not exists first_seen_at timestamptz default now();
alter table leak_finding add column if not exists seen_at timestamptz;
alter table item add column if not exists leak_scanned_at timestamptz;
-- D's Archive watch (daily): candidate pages per question. Candidates, never confirmed leaks.
create table if not exists leak_archive_watch (item_id text, run_at timestamptz, candidates int, error text, primary key (item_id, run_at));
