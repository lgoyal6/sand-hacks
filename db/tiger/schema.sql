-- Tiger Data (TimescaleDB) telemetry schema (build plan section 3.3). Owner: D, written to by A and C.
create table if not exists interaction_events (ts timestamptz not null, attempt_id text not null, item_id text, kind text not null, payload jsonb);
select create_hypertable('interaction_events', 'ts', if_not_exists => true);
create table if not exists agent_run_events (ts timestamptz not null, run_id text not null, item_id text, action text, payload jsonb);
select create_hypertable('agent_run_events', 'ts', if_not_exists => true);
create table if not exists probe_timing (ts timestamptz not null, probe_id text not null, phase text not null, ms int);
select create_hypertable('probe_timing', 'ts', if_not_exists => true);
-- Continuous aggregates, state_agg, heartbeat_agg: D adds these in db/tiger/aggregates.sql
