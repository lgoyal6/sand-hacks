# services/agents: Agent Attack (workstream A)

Real browser agents take our **own sandbox** quiz (`apps/sandbox`, port 3101) the way a student's agent would: log in,
open the quiz, answer, submit. Correctness comes from the sandbox's server-side grading, never from the agent's own report.

## Run

```sh
pnpm --filter @unprompted/sandbox start          # terminal 1: sandbox on :3101
cd services/agents && uv sync
uv run attack --quiz ../../apps/sandbox/quizzes/stats-101.json \
  --models gemini:gemini-2.5-flash --repeats 3   # needs GEMINI_API_KEY in repo-root .env.local
```

Writes `data/fixtures/agent_runs.json` (AgentRun[]), `solve_rates.json` (SolveRate[], `agentSolvable` at >= 0.6) and
`attack_summary.json` (accuracy with a 95% Wilson CI, plus per-run status/steps/cost). Full traces go to `traces/` (gitignored).

Models: `gemini:<id>` (Gemini), `gmi:<id>` (GMI Cloud, OpenAI-compatible; `GMI_API_KEY`, `GMI_BASE_URL`).

## For B's workflow: `attack(quiz, items)`

Python:

```python
from unprompted_agents.attack import attack
res = attack(quiz, ["stats-101-q1"], models=["gemini:gemini-2.5-flash"], repeats=3)
res["agentRuns"]; res["solveRates"]; res["summary"]
```

CLI (from TypeScript/Mastra, spawn it and read stdout; logs go to stderr):

```sh
echo "$QUIZ_JSON" | uv run --directory services/agents attack --quiz - --items stats-101-q1 --repeats 3 --json
```

`quiz` is a shared `Quiz`. Variant candidates are just quizzes whose items carry `originalItemId`; the sandbox registers
whatever quiz it's given (`POST /api/quizzes`), so new variants need no deploy.

## Guard rails

- Only localhost sandboxes (`SANDBOX_ALLOW_REMOTE=1` is for our own Vultr deploy only). The browser is local Chromium
  locked to the sandbox host with `allowed_domains`. browser-use 1.0 defaults to a cloud browser; we never use it.
- The runner API (`/api/runs`, `/api/quizzes`) needs `x-runner-token` (`SANDBOX_RUNNER_TOKEN`), so the agent, which
  runs code in the page, can't read its own grades.
- A crashed or unfinished run counts as incorrect on every item. The first submitted attempt counts.

## Field notes

- `seconds` per item: sandbox-measured time to the item's last answer change. If the agent set values without firing
  input events (`answerChanges` = 0 in `attack_summary.json`), it falls back to an even share of the run time. That is
  itself an agent signal for D's model.
- `steps`: browser-use 1.0 model requests for the whole run (there are no per-item steps in 1.0).
