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
alter table item add column if not exists figure_text text;
-- C: accessible-version requests per attempt, e.g. [{itemId, kind: "figure_text", at}]
alter table attempt add column if not exists accommodations jsonb default '[]';
