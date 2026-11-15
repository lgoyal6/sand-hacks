# Unprompted

A learning app for the age of AI agents. Unprompted attacks a professor's quiz with the same browser agents students use, rewrites the questions agents solve into versions they fail (while still testing the same skill), and asks students to talk through their reasoning at the moments an agent would have answered for them.

> Formerly "ThinkAloud". The full product spec is [`docs/build-plan.md`](docs/build-plan.md). Team ownership and git rules are in [`docs/CONTRACTS.md`](docs/CONTRACTS.md).

## What's in the repo

| Path | What it is | Stack |
|---|---|---|
| `apps/web` | The app: student chat and quiz runtime, voice think-aloud probe, telemetry, professor studio and insights | Next.js 16, Tailwind 4, shadcn/ui |
| `apps/sandbox` | A minimal quiz site that agents attack in isolation | Node, zero deps |
| `services/agents` | Agent Attack runner (`attack` CLI): browser-use and Stagehand against the sandbox or the real runtime | Python (uv), TS |
| `services/workflows` | Question transform engine: generate variants, solve, judge panel, re-attack, merge survivors on Neon branches | TypeScript, Mastra (thin wrapper) |
| `services/leakscan` | Finds quiz questions already posted online (Bright Data SERP) | TypeScript |
| `db/neon` | App schema (Neon Postgres) | SQL |
| `db/tiger` | Telemetry hypertables, continuous aggregates and detection features (Tiger Data) | SQL |
| `packages/shared` | Shared TypeScript types between all workstreams | TS |
| `data/quizzes` | Quizzes we wrote ourselves (the only content sent to LLMs) | Markdown |
| `data/fixtures` | Real outputs from runs (agent runs, solve rates, leaks, variants), used by the UI until live data exists | JSON |

## Setup

Requirements: Node 25+, pnpm 10, Python 3.13 with [uv](https://docs.astral.sh/uv/), Chromium (installed by Playwright/browser-use).

```bash
pnpm install
cp .env.example .env.local   # then fill in the keys below
```

### Environment variables

All services read one file, `.env.local` at the repo root. **Never commit it.** It is gitignored; only `.env.example` (names, no values) is tracked.

| Variable | Used by | Where to get it |
|---|---|---|
| `GEMINI_API_KEY` | agents, transform, probe follow-ups | Google AI Studio. The free tier allows only ~20 requests per model per day, so enable billing for real runs |
| `GMI_API_KEY` | optional: extra council and attacker models | GMI Cloud |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID` | voice probe | ElevenLabs → Developers → API Keys; the agent is created via the API |
| `BRIGHTDATA_API_TOKEN`, `BRIGHTDATA_SERP_ZONE`, `BRIGHTDATA_UNLOCKER_ZONE`, `BRIGHTDATA_BROWSER_ZONE`, `BRIGHTDATA_CUSTOMER_ID`, `BRIGHTDATA_BROWSER_WSS` | leak scan | Bright Data → Settings → API keys, plus Web Access zones |
| `NEON_API_KEY`, `NEON_PROJECT_ID`, `DATABASE_URL` | app data, branch-per-experiment | Neon console (use a project-scoped API key) |
| `TIGER_DATABASE_URL` | telemetry | `tiger service create`, then `tiger db uri <id> --with-password` |
| `CANVAS_BASE_URL`, `CANVAS_TOKEN` | optional: Connect Canvas import | a Canvas teacher account |

Quote values that contain `&` (database URLs), so shells can source the file.

### Databases

```bash
# Neon (app data)
psql "$DATABASE_URL" -f db/neon/schema.sql
# Tiger (telemetry) — no psql? use: uv run --with "psycopg[binary]" python db/tiger/scripts/sql.py <file>
psql "$TIGER_DATABASE_URL" -f db/tiger/schema.sql
psql "$TIGER_DATABASE_URL" -f db/tiger/aggregates.sql
```

## Run it

```bash
pnpm dev:web        # app on http://localhost:3100
pnpm dev:sandbox    # agent sandbox on http://localhost:3101
```

| Task | Command |
|---|---|
| Attack a quiz with agents | `cd services/agents && uv run attack --quiz ../../data/quizzes/sample-stats.md --agents browser-use,stagehand` (add `--target runtime` to attack the real app) |
| Import a quiz | `pnpm --filter @unprompted/workflows ingest data/quizzes/sample-stats.md --quiz-id sample-stats` |
| Transform agent-solvable questions | `pnpm --filter @unprompted/workflows transform` (`LLM_CACHE=replay` reuses saved responses and spends nothing) |
| Neon branch check | `pnpm --filter @unprompted/workflows killtest:neon` |
| Leak scan | `pnpm --filter @unprompted/leakscan scan` |

## Tests

```bash
pnpm --filter @unprompted/web typecheck        # runs `next typegen` first on a fresh checkout
pnpm --filter @unprompted/workflows test
pnpm --filter @unprompted/leakscan test
pnpm --filter @unprompted/sandbox test
cd services/agents && uv run pytest
```

## Status: Phase 0 checks (real data, Nov 14 2026)

| # | Check | Result |
|---|---|---|
| 1 | A real agent aces our quiz | **Pass.** browser-use + Gemini scored 10/10 answers over 2 completed runs (95% CI 72 to 100%). A third run hit the free-tier rate limit and is excluded, not counted as a failure |
| 2 | Voice probe returns a timestamped transcript | **Pass in text mode** against the real ElevenLabs agent; not yet tested with a live microphone |
| 3 | Leak scan finds real leaks | **Pass.** 10/10 OpenStax exercises found on study sites; 2/5 of our own items matched (1 real, 1 likely false positive shown with evidence) |
| 4 | Telemetry lands in Tiger and aggregates compute | **Pass** |
| 5 | Neon branch create, write and merge from code | **Pass** on real Neon (6.5 s) |

## Ground rules

- Never label a student a cheater. Flags are evidence for a follow-up conversation.
- Agents only attack our own sandboxes, never real courses or accounts.
- Only our own quizzes go to LLMs. OpenStax text is CC BY-NC-SA and forbids generative-AI use; it is used only as leak-scan search strings, with attribution.
- Leak evidence is snippets, URLs and screenshots, never copyrighted solutions. We never solve or bypass CAPTCHAs.
- Report real numbers, including bad ones.
