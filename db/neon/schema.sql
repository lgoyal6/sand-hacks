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
