"""attack CLI.

  uv run attack --quiz ../../apps/sandbox/quizzes/sample-stats.json --models gemini:gemini-3.5-flash --repeats 3

Writes data/fixtures/agent_runs.json, solve_rates.json and attack_summary.json (repo root), full traces to traces/.
With --json, prints the result to stdout instead of writing fixtures (what B's workflow uses).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

REPO = Path(__file__).resolve().parents[4]


def _load(p: Path, default):
    try:
        return json.loads(p.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _dump(p: Path, obj) -> None:
    p.write_text(json.dumps(obj, indent=2) + "\n")


def write_fixtures(out: Path, quiz_id: str, result: dict, runtime: bool = False) -> None:
    """Merge this quiz's results into the shared fixtures, replacing earlier results for the same quiz only.

    Sandbox: agent_runs.json, solve_rates.json (all quizzes), attack_summaries.json ({quizId: summary}), and
    attack_summary.json (the sample-stats headline, the shape the dashboards read).
    Runtime: runtime_agent_runs.json and runtime_attack_summaries.json; solve rates stay sandbox-only so every
    quiz is measured the same way.
    """
    summary = {**result["summary"], "quizId": quiz_id, "runs": result["runs"]}
    summary["isolated"] = bool(result["runs"]) and all(m.get("isolated") is True for m in result["runs"])
    if not summary["isolated"]:
        # Headline numbers come only from sandboxed agents. Anything else is kept, labelled, in the history file.
        hist = _load(out / "attack_history_unisolated.json", {})
        hist.setdefault(quiz_id, []).append({**summary, "agentRuns": result["agentRuns"]})
        _dump(out / "attack_history_unisolated.json", hist)
        print(f"[fixtures] {quiz_id}: runs were not isolated; saved to attack_history_unisolated.json, headline untouched")
        return
    prefix = "runtime_" if runtime else ""
    runs = [r for r in _load(out / f"{prefix}agent_runs.json", []) if r["quizId"] != quiz_id]
    _dump(out / f"{prefix}agent_runs.json", runs + [{**r, "quizId": quiz_id} for r in result["agentRuns"]])
    summaries = _load(out / f"{prefix}attack_summaries.json", {})
    summaries[quiz_id] = summary
    _dump(out / f"{prefix}attack_summaries.json", summaries)
    if runtime:
        return
    item_ids = {s["itemId"] for s in result["solveRates"]}
    rates = [r for r in _load(out / "solve_rates.json", []) if r["itemId"] not in item_ids]
    _dump(out / "solve_rates.json", rates + result["solveRates"])
    if quiz_id == "sample-stats":
        _dump(out / "attack_summary.json", summary)


def main(argv: list[str] | None = None) -> int:
    try:
        load_dotenv(REPO / ".env.local")
    except PermissionError:
        pass  # isolated run (isolation/run.sh): keys arrive via the environment instead
    os.environ.setdefault("ANONYMIZED_TELEMETRY", "false")

    ap = argparse.ArgumentParser(prog="attack", description="Run real browser agents on a sandbox quiz.")
    ap.add_argument("--quiz", required=True, help="Quiz JSON (packages/shared Quiz), or - for stdin")
    ap.add_argument("--items", default="", help="comma-separated item ids to attack (default: all)")
    ap.add_argument("--sandbox-url", default=os.environ.get("SANDBOX_URL", "http://localhost:3101"))
    ap.add_argument("--target", choices=["sandbox", "runtime"], default="sandbox",
                    help="sandbox = apps/sandbox :3101; runtime = C's apps/web :3100 with telemetry and probes on")
    ap.add_argument("--runtime-url", default=os.environ.get("RUNTIME_URL", "http://localhost:3100"))
    ap.add_argument("--agents", default="browser-use")
    ap.add_argument("--models", default="gemini:gemini-3.5-flash",
                    help="comma-separated; gemini:<id>, gmi:<id> (GMI Cloud, OpenAI-compatible)")
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--max-steps", type=int, default=60,
                    help="browser-use step limit per run (variant pages can need more than the original's 10-30)")
    ap.add_argument("--out-dir", default=str(REPO / "data" / "fixtures"))
    ap.add_argument("--traces-dir", default=str(REPO / "traces"))
    ap.add_argument("--json", action="store_true", help="print result JSON to stdout, don't write fixtures")
    ap.add_argument("--unsafe-no-isolation", action="store_true",
                    help="allow browser agents outside isolation/attack.sb (recorded as isolated=false on every run)")
    ap.add_argument("--events", action="store_true",
                    help="stream NDJSON agent events to stdout (shared agent-event shape, agentId quiz-checker); "
                         "the last line is status 'done' with the full result. Implies --json; logs go to stderr")
    a = ap.parse_args(argv)

    os.environ["ATTACK_MAX_STEPS"] = str(a.max_steps)
    if a.unsafe_no_isolation:
        os.environ["UNPROMPTED_UNSAFE_NO_ISOLATION"] = "1"
    if a.quiz.endswith(".md"):
        from .quiz_md import parse_quiz_md

        quiz = parse_quiz_md(a.quiz)
    else:
        quiz = json.load(sys.stdin if a.quiz == "-" else open(a.quiz))
    a.json = a.json or a.events
    log = (lambda m: print(m, file=sys.stderr)) if a.json else print

    def emit(status: str, label: str, tool_call: dict | None = None, **extra) -> None:
        ev = {"agentId": "quiz-checker", "status": status, "label": label,
              "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}
        if tool_call:
            ev["toolCall"] = tool_call
        print(json.dumps({**ev, **extra}), flush=True)
    try:
        result = _run(a, quiz, log, emit if a.events else None)
    except Exception as e:
        if a.events:
            emit("error", f"Attack failed: {e}"[:300])
            return 1
        raise
    if a.events:
        s = result["summary"]
        label = (f"Agents solved {s['itemCorrect']}/{s['itemRuns']} answers ({s['accuracy']:.0%}, 95% CI "
                 f"{s['accuracyCI95'][0]:.0%}-{s['accuracyCI95'][1]:.0%}), {s['infraErrors']} provider errors excluded"
                 if s["accuracy"] is not None else f"No usable runs ({s['infraErrors']} provider errors)")
        emit("done", label, result=result)
        return 0
    if a.json:
        json.dump(result, sys.stdout, indent=2)
        return 0
    return _report(a, quiz, result)


def _run(a, quiz, log, on_event):
    from .attack import attack
    from .sandbox import Runtime, Sandbox

    return attack(
        quiz,
        [i for i in a.items.split(",") if i] or None,
        agents=[x for x in a.agents.split(",") if x],
        models=[x for x in a.models.split(",") if x],
        repeats=a.repeats,
        sandbox=Runtime(a.runtime_url) if a.target == "runtime" else Sandbox(a.sandbox_url),
        traces_dir=Path(a.traces_dir),
        log=log,
        on_event=on_event,
    )


def _report(a, quiz, result) -> int:
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    s = result["summary"]
    if s["accuracy"] is None:
        print(f"\nNo usable runs ({s['infraErrors']} provider errors). Nothing measured; fixtures left unchanged.")
        return 1
    write_fixtures(out, quiz["id"], result, runtime=a.target == "runtime")
    print(f"\nAgents answered {s['itemCorrect']}/{s['itemRuns']} item-runs correctly "
          f"({s['accuracy']:.0%}, 95% CI {s['accuracyCI95'][0]:.0%} to {s['accuracyCI95'][1]:.0%}); "
          f"{s['attemptsCompleted']}/{s['attempts']} attempts submitted; {s['infraErrors']} provider errors excluded.")
    for r in result["solveRates"]:
        print(f"  {r['itemId']:<16} {r['correct']}/{r['runs']}  solvable={r['agentSolvable']}")
    print(f"updated fixtures in {out} for quiz {quiz['id']} ({a.target})")
    return 0


def merge_main(argv: list[str] | None = None) -> int:
    """Outside the sandbox: merge a sandboxed `attack --json` result into the fixtures."""
    ap = argparse.ArgumentParser(prog="attack-merge")
    ap.add_argument("result")
    ap.add_argument("--quiz-id", required=True)
    ap.add_argument("--target", choices=["sandbox", "runtime"], default="sandbox")
    ap.add_argument("--out-dir", default=str(REPO / "data" / "fixtures"))
    a = ap.parse_args(argv)
    result = json.loads(Path(a.result).read_text())
    s = result["summary"]
    if s["accuracy"] is None:
        print(f"No usable runs ({s['infraErrors']} infra, {s.get('didNotSubmit', 0)} did not submit); fixtures unchanged.")
        return 1
    write_fixtures(Path(a.out_dir), a.quiz_id, result, runtime=a.target == "runtime")
    print(f"{a.quiz_id}: {s['itemCorrect']}/{s['itemRuns']} ({s['accuracy']:.0%}, 95% CI {s['accuracyCI95'][0]:.0%}-"
          f"{s['accuracyCI95'][1]:.0%}); {s['infraErrors']} infra, {s.get('didNotSubmit', 0)} did not submit; fixtures updated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
