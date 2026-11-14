"""attack(quiz, items) -> AgentRun[]  (the interface B's transform workflow calls; see docs/CONTRACTS.md)."""

from __future__ import annotations

import itertools
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .runners import RUNNERS, RunOutcome, save_trace
from .sandbox import Sandbox
from .stats import solve_rates, summary


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def to_agent_runs(quiz: dict, outcome: RunOutcome, attempts: list[dict], item_ids: list[str]) -> tuple[list[dict], dict]:
    """One AgentRun per item for this run, graded by the sandbox. Uses the first submitted attempt, like a quiz
    that counts the first try; if the agent never submitted, every item is incorrect."""
    submitted = [a for a in attempts if a.get("submittedAt")]
    attempt = submitted[0] if submitted else (attempts[0] if attempts else None)
    by_item = {i["itemId"]: i for i in (attempt["items"] if attempt else [])}
    n = len(item_ids)
    runs = []
    for item_id in item_ids:
        r = by_item.get(item_id, {})
        secs = r.get("seconds")
        runs.append(
            {
                "id": f"{outcome.run_id}:{item_id}",
                "quizId": quiz["id"],
                "itemId": item_id,
                "agent": outcome.agent,
                "model": outcome.model,
                "correct": bool(attempt and attempt.get("submittedAt") and r.get("correct")),
                # Sandbox-measured time to the item's last answer change; falls back to an even share of the run when
                # the agent set values without firing input events (itself a useful agent signal: answerChanges=0).
                "seconds": round(secs if secs is not None else outcome.seconds / max(n, 1), 2),
                # Steps are model requests for the whole run (browser-use 1.0 has no per-item steps).
                "steps": outcome.steps,
                "runAt": _now(),
            }
        )
    meta = {
        "runId": outcome.run_id,
        "agent": outcome.agent,
        "model": outcome.model,
        "status": outcome.status,
        "error": outcome.error,
        "steps": outcome.steps,
        "seconds": round(outcome.seconds, 2),
        "costUsd": outcome.cost_usd,
        "submitted": bool(submitted),
        "attemptsStarted": len(attempts),
        "score": (sum(r["correct"] for r in runs) / n) if n else None,
        "answerChanges": {k: v.get("answerChanges") for k, v in by_item.items()},
    }
    return runs, meta


def attack(quiz: dict, items: list[str] | None = None, *, agents=("browser-use",), models=("gemini:gemini-2.5-flash",),
           repeats: int = 3, sandbox: Sandbox | None = None, traces_dir: Path | None = None, runners=None,
           log=print) -> dict:
    """Run every agent x model x repeat on `quiz` (optionally only `items`) in fresh browsers.

    Returns {"agentRuns": AgentRun[], "solveRates": SolveRate[], "summary": {...}, "runs": [per-run meta]}.
    """
    sandbox = sandbox or Sandbox()
    runners = runners or RUNNERS
    if items:
        keep = set(items)
        quiz = {**quiz, "items": [i for i in quiz["items"] if i["id"] in keep]}
        # A fresh quiz id per subset; item ids stay stable so solve rates line up with the original items.
        quiz["id"] = f'{quiz["id"]}--{uuid.uuid4().hex[:6]}'
    if not quiz["items"]:
        raise ValueError("no items to attack")
    sandbox.register(quiz)
    item_ids = [i["id"] for i in quiz["items"]]

    all_runs: list[dict] = []
    metas: list[dict] = []
    for agent, model, rep in itertools.product(agents, models, range(repeats)):
        if agent not in runners:
            raise ValueError(f"unknown agent {agent!r}; have {sorted(runners)}")
        run_id = f"run-{uuid.uuid4().hex[:10]}"
        log(f"[attack] {agent} / {model} / repeat {rep + 1}/{repeats}  run={run_id}")
        outcome = runners[agent](sandbox, run_id, quiz["title"], model)
        if traces_dir:
            save_trace(outcome, traces_dir)
        runs, meta = to_agent_runs(quiz, outcome, sandbox.run_results(run_id), item_ids)
        log(f"[attack]   status={meta['status']} submitted={meta['submitted']} score={meta['score']} "
            f"steps={meta['steps']} {meta['seconds']}s" + (f" error={meta['error']}" if meta["error"] else ""))
        all_runs += runs
        metas.append(meta)

    return {
        "agentRuns": all_runs,
        "solveRates": solve_rates(all_runs, item_ids),
        "summary": {"quizId": quiz["id"], **summary(all_runs, metas)},
        "runs": metas,
    }
