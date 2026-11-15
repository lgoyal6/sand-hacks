# services/agents: Agent Attack (workstream A)

Real browser agents take our **own sandbox** quiz (`apps/sandbox`, port 3101) the way a student's agent would: log in,
open the quiz, answer, submit. Correctness comes from the sandbox's server-side grading, never from the agent's own report.

## Run

```sh
pnpm --filter @unprompted/sandbox start          # terminal 1: sandbox on :3101
cd services/agents && uv sync
uv run attack --quiz ../../apps/sandbox/quizzes/sample-stats.json \
  --models gemini:gemini-3.5-flash --repeats 3   # needs GEMINI_API_KEY in repo-root .env.local
```

Writes `data/fixtures/agent_runs.json` (AgentRun[]), `solve_rates.json` (SolveRate[], `agentSolvable` at >= 0.6) and
`attack_summary.json` (accuracy with a 95% Wilson CI, plus per-run status/steps/cost). Full traces go to `traces/` (gitignored).

Agents: `--agents browser-use,stagehand`. Stagehand v4 has no autonomous mode, so its runner is the script a student
would write: plain-code login, then one `act("answer question N correctly")` per question (sandbox only, Gemini only).

Targets: `--target sandbox` (default, :3101) or `--target runtime` (C's real quiz at `:3100/quiz/<id>?mode=graded`,
telemetry and think-aloud probes on). Runtime attempts are tagged `student=agent-<runId>`, so D can label them as the
agent class, and are graded from C's token-guarded `GET /api/attempts?student=`. Agents run plainly, with no detection
evasion. `attack_summary.json` marks `stuckAtProbe` when an attempt never finished after a probe opened.

Models: `gemini:<id>` (Gemini), `gmi:<id>` (GMI Cloud, OpenAI-compatible; `GMI_API_KEY`, `GMI_BASE_URL`).

## For B's workflow: `attack(quiz, items)`

Python:

```python
from unprompted_agents.attack import attack
res = attack(quiz, ["sample-stats-q1"], models=["gemini:gemini-3.5-flash"], repeats=3)
res["agentRuns"]; res["solveRates"]; res["summary"]
```

CLI (from TypeScript/Mastra, spawn it and read stdout; logs go to stderr):

```sh
echo "$QUIZ_JSON" | uv run --directory services/agents attack --quiz - --items sample-stats-q1 --repeats 3 --json
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

## Isolation (run attacks through this)

browser-use 1.0 runs model-written Python on the host as your user; its own docs say it is "not a sandbox". In our
runs the agent ran `ps aux` looking for the server's code. `isolation/run.sh` wraps the attack in a macOS
`sandbox-exec` profile (`isolation/attack.sb`): the agent process cannot read `.env` files, `sand-hacks-context`, other
worktrees, this repo's quiz or fixture files (answer keys), `~/.ssh`, `~/.aws` or `~/.claude`, and cannot run `ps`, `pgrep`,
`lsof` or `top`, and cannot open any network connection except to localhost: model API calls leave through
`isolation/egress_proxy.py`, which runs outside the sandbox and only connects to the GMI and Gemini API hosts. (browser-use's
own `allowed_domains` only guards main-frame navigation, not page `fetch()` or the agent's Python.) Only the model keys and the runner token are passed in, as environment variables. Fixtures are merged
outside the sandbox (`attack-merge`). This is defense in depth, not a VM.

```sh
isolation/run.sh ../../data/quizzes/econ-micro.md --models gmi:google/gemini-3.8-flash --repeats 3
```

Verified: denials checked directly, and a full isolated run of econ-micro scored 6/6 with no host access in its trace. Chrome runs with --no-sandbox (isolation/chrome.sh) because its own sandbox cannot start nested inside sandbox-exec; the outer profile still applies to it. Browser agents refuse to start outside isolation unless --unsafe-no-isolation is passed, and every run records isolated=true/false.
