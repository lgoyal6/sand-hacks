# Unprompted: team contracts (who owns what, how we integrate)

**The product is now called Unprompted** (formerly ThinkAloud; `docs/build-plan.md` still uses the old name). Use "Unprompted" in all UI copy, package names (`@unprompted/*`) and docs. The voice probe feature can still be described as a "think-aloud" probe.

Read this before touching code. The product spec is `docs/build-plan.md`.

## Owners

Paths are relative to the repo root. Only edit files you own. If you need something changed in another person's area, message them (or the orchestrator).

| Workstream | Session | Branch | Worktree | Owns |
|---|---|---|---|---|
| A: agents and red-team | datnguyen-8f | `a/agents` | `~/Desktop/PROJECTS/sand-hacks-a` | `apps/sandbox/**`, `services/agents/**`, `data/fixtures/agent_runs.json`, `data/fixtures/solve_rates.json` |
| B: transform engine | datnguyen-f6 | `b/transform` | `~/Desktop/PROJECTS/sand-hacks-b` | `services/workflows/**`, `db/neon/**`, `apps/web/app/studio/**`, `apps/web/lib/canvas/**`, `apps/web/app/api/agents/**`, `apps/web/lib/agents/**`, `data/fixtures/variants.json` |
| C: student runtime, voice, telemetry | datnguyen-fb | `c/runtime` | `~/Desktop/PROJECTS/sand-hacks-c` | the `apps/web` scaffold (package.json, next config, root layout, `lib/db`), `apps/web/app/(student)/**`, `apps/web/app/course/**`, `apps/web/lib/telemetry/**`, `apps/web/components/quiz/**`, `apps/web/components/probe/**`, `data/fixtures/attempts.json`, `data/fixtures/probes.json` |
| D: data, leak scan, dashboards, design, deploy | datnguyen-76 | `d/dashboards` | `~/Desktop/PROJECTS/sand-hacks-d` | `services/leakscan/**`, `services/models/**`, `db/tiger/**`, `infra/**`, **the visual design system** (`apps/web/app/globals.css`, `apps/web/components/ui/**`, `apps/web/components/dashboard/**`), `apps/web/app/professor/**`, `apps/web/app/progress/**`, `data/fixtures/leaks.json` |
| Shared, change by agreement | | | | `packages/shared/**` (the TypeScript types), `docs/CONTRACTS.md`, root `package.json` and `pnpm-workspace.yaml` |

## Stack (decided, don't relitigate)

- Monorepo with pnpm workspaces. Node 25, pnpm 10.
- `apps/web`: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui, components in `apps/web/components/ui`. One app serves the professor studio, student quiz runtime and dashboards.
- `apps/sandbox`: the minimal quiz page that agents attack in Phase 0. Later, runners take a `QUIZ_URL` and also attack the real runtime in `apps/web`.
- Workflows: Mastra (TypeScript) in `services/workflows`.
- Python services (`services/agents` browser-use runner, `services/models`): each has its own `pyproject.toml` and uses `uv`.
- LLMs: Gemini on the critical path. GMI Cloud open models for 2 of the 3 grading-council seats and for extra attacker models.
- DBs: Neon Postgres (`db/neon/schema.sql`) and Tiger Data (`db/tiger/schema.sql`).

## Ports (8 GB machine, so keep only what you need running)

| Port | What | Owner |
|---|---|---|
| 3100 | `apps/web` dev server | C starts it; everyone uses it |
| 3101 | `apps/sandbox` | A |
| 3102 | Mastra / workflows dev server | B |

Don't start a second copy of a server someone else is running. Only run one headless browser at a time unless you're doing an attack batch.

## Data when keys are missing: fixtures

API keys go in a repo-root `.env.local` (template: `.env.example`, never commit). Until a key exists, **don't block on it**:
- Every producer also writes its output as JSON matching `packages/shared/src/index.ts` into `data/fixtures/<name>.json`.
- Consumers (dashboards especially) build against the fixtures first, then switch to the DB.
- If you need a key, say which one to the orchestrator. Don't invent or hardcode keys.

## Git workflow

- `main` belongs to the repo owner (lgoyal6). **Never push to `main`.** Dat merges `dev` into `main` with the owner's approval.
- `dev` is the shared trunk. Work on your own branch in your own worktree, commit often, then integrate:
  ```
  git fetch origin && git rebase origin/dev && git push origin HEAD:dev && git push -u origin HEAD
  ```
- Because each person owns separate files, rebases should be clean. If there's a conflict in someone else's file, stop and message them. Don't resolve it for them.
- Commit messages: plain, imperative. Author is Dat. **No `Co-Authored-By` or Claude attribution lines.**
- Never commit `.env*` (except `.env.example`), audio, real student data, or large traces.

## Integration points (who waits on whom)

1. **C → everyone:** a running `apps/web` shell with Tailwind + shadcn initialized, pushed to `dev` as early as possible. D and B add their routes on top of it.
2. **D → C, B:** the theme tokens and the `components/ui` set from the design doc. Until then, use the shadcn defaults and don't hand-style.
3. **A → B, D:** `solve_rates.json` and `agent_runs.json`. B uses them to choose which items to transform; D's heat map reads them.
4. **B → A:** variant candidates that A re-attacks. A exposes a function/CLI `attack(quiz, items) -> AgentRun[]` that B's workflow calls.
5. **C → D:** telemetry events in Tiger (or `data/fixtures/interaction_events.jsonl`) for the agent-likelihood model and session timelines.
6. **A → D:** agent sessions run against the real runtime (with C's telemetry on) give D the "agent" class of training data.

## Ground rules from the build plan

- Never call a student a cheater in UI copy. Flags say "suggest a follow-up chat".
- Agents only attack our own sandboxes, never real courses or accounts.
- Store leak snippets, URLs and screenshots only, never copyrighted solutions.
- Report real numbers, including bad ones. No faked results in the demo.
- **Deploy target:** Vultr only, with a GoDaddy domain. Never deploy to Vercel, Netlify or any other host, and never connect the repo to one.
- **Models: Gemini only.** Every LLM call uses a Google Gemini model, either via the direct key (GEMINI_API_KEY) or via GMI (GMI_BASE_URL, `google/gemini-*` models only, no other families). Judge panels use 3 different Gemini models and are labelled "three Gemini models".
- **Agents look like siblings:** every Mastra agent (Tutor, Explain coach, Researcher, Quiz checker, Rewriter, Judge panel, Leak scout, Supervisor) is drawn with one parameterized `<AgentAvatar agent=... state=...>` (owner D): same family, distinct hue, pattern and motion per agent. Agent events use one shared shape from `packages/shared`.
- **No emojis** anywhere in the repo: code, UI copy, docs or commit messages. Use lucide icons for check, cross and similar marks.
- **Figure-only questions need an accommodation path:** when key data lives only in an image (to resist agents), the `alt` text must not leak it, so screen-reader users get an "accessible version" on request that states the data in text and always triggers a think-aloud probe. Never penalize using it. Mention this trade-off honestly in the pitch.
- **Question content and licensing:** OpenStax Introductory Statistics 2e is CC BY-NC-SA 4.0 and forbids feeding it to LLMs or generative AI. Never send OpenStax text to Gemini, GMI or browser agents (no transforms, attacks, embeddings or probes). Quizzes that touch an LLM must be our own writing (`data/quizzes/*.md`). OpenStax stems may be used only as exact-phrase search strings in the leak scan, with attribution.

## IDs (decided)

- Quiz id = the quiz file's slug: `data/quizzes/sample-stats.md` gives quiz id `sample-stats`.
- Item id = `<quizId>-q<n>`, with n the 1-based number in the Markdown (`sample-stats-q1`). Variants: `<itemId>-v<k>`.
- B's Markdown parser (`services/workflows/src/ingest/markdown.ts`) is the single source of truth. C and A consume it, or its fixture output, and don't re-derive ids.
