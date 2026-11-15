"""attack(quiz, items) -> AgentRun[]  (the interface B's transform workflow calls; see docs/CONTRACTS.md)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

from .runners import RUNNERS, RunOutcome, isolated, save_trace
from .sandbox import Sandbox
from .stats import solve_rates, summary


# A run whose loop died (status "error") before submitting says nothing about whether the agent can do the quiz:
# the model provider refused or failed, or our local browser didn't start. Those runs are excluded from solve rates
# and reported in summary.infraErrors with a reason. Runs that ran to the end (completed, max_steps, timeout) count,
# including ones that never submitted: that is the agent failing.
INFRA_REASONS = (
    ("ContentFilterError", "provider content filter"),
    ("ModelRateLimitError", "provider quota"),
    ("status_code: 429", "provider quota"),
    ("ModelUnavailableError", "provider unavailable"),
    ("status_code: 503", "provider unavailable"),
    ("ModelNotFoundError", "model not found"),
    ("ModelRequestRejectedError", "provider rejected request"),
    ("CDP WS handshake", "local browser failed to start"),
)


def infra_reason(status: str, error: str | None, submitted: bool) -> str | None:
    if submitted or status != "error":
        return None
    for marker, reason in INFRA_REASONS:
        if error and marker in error:
            return reason
    return "run crashed before submitting"


def is_infra_error(error: str | None) -> bool:  # kept for callers; classification is infra_reason
    return infra_reason("error", error, False) is not None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def to_agent_runs(quiz: dict, outcome: RunOutcome, attempts: list[dict], item_ids: list[str]) -> tuple[list[dict], dict]:
    """One AgentRun per item for this run, graded by the sandbox. Uses the first submitted attempt, like a quiz
    that counts the first try. If the agent never submitted, the caller drops these AgentRuns (outcome
    "did_not_submit" is reported separately, never as wrong answers); meta.answeredNotSubmitted keeps whatever the
    agent had selected, graded, for diagnosis."""
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
    pending = {}
    if attempt and not attempt.get("submittedAt"):
        for item_id, r in by_item.items():
            if r.get("pendingAnswer") is not None or r.get("answered"):
                pending[item_id] = {"answer": r.get("pendingAnswer", r.get("answer")),
                                    "correct": r.get("pendingCorrect", r.get("correct"))}
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
        "answeredNotSubmitted": pending or None,
        "attemptsStarted": len(attempts),
        "score": (sum(r["correct"] for r in runs) / n) if n else None,
        "answerChanges": {k: v.get("answerChanges") for k, v in by_item.items()},
        "target": "runtime" if attempt and "finished" in attempt else "sandbox",
        "probesTriggered": (attempt or {}).get("probesTriggered"),
        # Runtime only: answered something but never finished, with a probe opened -> most likely stalled at the probe.
        "stuckAtProbe": bool(attempt and "finished" in attempt and not attempt["finished"] and attempt.get("probesTriggered")),
    }
    return runs, meta


def attack(quiz: dict, items: list[str] | None = None, *, agents=("browser-use",), models=("gemini:gemini-3.5-flash",),
           repeats: int = 3, sandbox: Sandbox | None = None, traces_dir: Path | None = None, runners=None,
           log=print, on_event=None) -> dict:
    """Run every agent x model x repeat on `quiz` (optionally only `items`) in fresh browsers.

    Returns {"agentRuns": AgentRun[], "solveRates": SolveRate[], "summary": {...}, "runs": [per-run meta]}.
    on_event(status, label, toolCall=None) gets live progress for the Agents panel (see cli --events).
    """
    emit = on_event or (lambda *a, **k: None)
    sandbox = sandbox or Sandbox()
    runners = runners or RUNNERS
    if items:
        keep = set(items)
        quiz = {**quiz, "items": [i for i in quiz["items"] if i["id"] in keep]}
        # A fresh quiz id per subset; item ids stay stable so solve rates line up with the original items.
        quiz["id"] = f'{quiz["id"]}--{uuid.uuid4().hex[:6]}'
    if not quiz["items"]:
        raise ValueError("no items to attack")
    item_ids = [i["id"] for i in quiz["items"]]
    if sandbox.kind == "runtime":
        sandbox.quiz_id, sandbox.item_ids = quiz["id"], item_ids
    sandbox.register(quiz)

    all_runs: list[dict] = []
    metas: list[dict] = []
    # "model@N" overrides the repeat count for that model (e.g. one run on the direct Gemini key).
    plan = []
    for agent in agents:
        for spec in models:
            model, _, n = spec.partition("@")
            plan += [(agent, model, rep, int(n) if n else repeats) for rep in range(int(n) if n else repeats)]
    emit("running", f"Attacking {quiz['title']}: {len(plan)} agent runs on {len(item_ids)} questions")
    for i, (agent, model, rep, reps) in enumerate(plan, 1):
        if agent not in runners:
            raise ValueError(f"unknown agent {agent!r}; have {sorted(runners)}")
        run_id = f"run-{uuid.uuid4().hex[:10]}"
        log(f"[attack] {agent} / {model} / repeat {rep + 1}/{reps}  run={run_id}")
        short = model.split("/")[-1].split(":")[-1]
        emit("running", f"Run {i}/{len(plan)}: {agent} with {short} is taking the quiz",
             {"name": "attack.run", "args": {"agent": agent, "model": model, "runId": run_id, "repeat": rep + 1}})
        outcome = runners[agent](sandbox, run_id, quiz["title"], model)
        if traces_dir:
            save_trace(outcome, traces_dir)
        runs, meta = to_agent_runs(quiz, outcome, sandbox.run_results(run_id), item_ids)
        log(f"[attack]   status={meta['status']} submitted={meta['submitted']} score={meta['score']} "
            f"steps={meta['steps']} {meta['seconds']}s" + (f" error={meta['error']}" if meta["error"] else ""))
        meta["infraReason"] = infra_reason(meta["status"], meta["error"], meta["submitted"])
        meta["infraError"] = meta["infraReason"] is not None
        meta["isolated"] = isolated()
        meta["outcome"] = "submitted" if meta["submitted"] else ("infra" if meta["infraError"] else "did_not_submit")
        n_ok = sum(r["correct"] for r in runs)
        emit("running", f"Run {i}/{len(plan)}: excluded ({meta['infraReason']})" if meta["infraError"]
             else f"Run {i}/{len(plan)}: {short} did not submit ({meta['status']}), not scored" if not meta["submitted"]
             else f"Run {i}/{len(plan)}: {short} got {n_ok}/{len(item_ids)} right in {meta['seconds']:.0f}s",
             {"name": "attack.run", "args": {"runId": run_id}, "result": {"correct": n_ok, "total": len(item_ids),
              "submitted": meta["submitted"], "providerError": meta["infraError"]}})
        if meta["infraError"]:
            log(f"[attack]   excluded from solve rates: {meta['infraReason']}")
        elif not meta["submitted"]:
            log(f"[attack]   did not submit ({meta['status']}): not scored; selected={meta['answeredNotSubmitted']}")
        else:
            all_runs += runs
        metas.append(meta)

    return {
        "agentRuns": all_runs,
        "solveRates": solve_rates(all_runs, item_ids),
        "summary": {
            "quizId": quiz["id"],
            **summary(all_runs, [m for m in metas if m["outcome"] == "submitted"]),
            "didNotSubmit": sum(m["outcome"] == "did_not_submit" for m in metas),
            "infraErrors": sum(m["infraError"] for m in metas),
            "infraReasons": {r: sum(m.get("infraReason") == r for m in metas) for r in {m.get("infraReason") for m in metas} if r},
        },
        "runs": metas,
    }
