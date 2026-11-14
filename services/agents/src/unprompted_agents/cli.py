"""attack CLI.

  uv run attack --quiz ../../apps/sandbox/quizzes/stats-101.json --models gemini:gemini-2.5-flash --repeats 3

Writes data/fixtures/agent_runs.json, solve_rates.json and attack_summary.json (repo root), full traces to traces/.
With --json, prints the result to stdout instead of writing fixtures (what B's workflow uses).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

REPO = Path(__file__).resolve().parents[4]


def main(argv: list[str] | None = None) -> int:
    load_dotenv(REPO / ".env.local")
    os.environ.setdefault("ANONYMIZED_TELEMETRY", "false")

    ap = argparse.ArgumentParser(prog="attack", description="Run real browser agents on a sandbox quiz.")
    ap.add_argument("--quiz", required=True, help="Quiz JSON (packages/shared Quiz), or - for stdin")
    ap.add_argument("--items", default="", help="comma-separated item ids to attack (default: all)")
    ap.add_argument("--sandbox-url", default=os.environ.get("SANDBOX_URL", "http://localhost:3101"))
    ap.add_argument("--agents", default="browser-use")
    ap.add_argument("--models", default="gemini:gemini-2.5-flash",
                    help="comma-separated; gemini:<id>, gmi:<id> (GMI Cloud, OpenAI-compatible)")
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--out-dir", default=str(REPO / "data" / "fixtures"))
    ap.add_argument("--traces-dir", default=str(REPO / "traces"))
    ap.add_argument("--json", action="store_true", help="print result JSON to stdout, don't write fixtures")
    a = ap.parse_args(argv)

    from .attack import attack
    from .sandbox import Sandbox

    quiz = json.load(sys.stdin if a.quiz == "-" else open(a.quiz))
    log = (lambda m: print(m, file=sys.stderr)) if a.json else print
    result = attack(
        quiz,
        [i for i in a.items.split(",") if i] or None,
        agents=[x for x in a.agents.split(",") if x],
        models=[x for x in a.models.split(",") if x],
        repeats=a.repeats,
        sandbox=Sandbox(a.sandbox_url),
        traces_dir=Path(a.traces_dir),
        log=log,
    )
    if a.json:
        json.dump(result, sys.stdout, indent=2)
        return 0

    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "agent_runs.json").write_text(json.dumps(result["agentRuns"], indent=2) + "\n")
    (out / "solve_rates.json").write_text(json.dumps(result["solveRates"], indent=2) + "\n")
    (out / "attack_summary.json").write_text(json.dumps({**result["summary"], "runs": result["runs"]}, indent=2) + "\n")
    s = result["summary"]
    print(f"\nAgents answered {s['itemCorrect']}/{s['itemRuns']} item-runs correctly "
          f"({s['accuracy']:.0%}, 95% CI {s['accuracyCI95'][0]:.0%} to {s['accuracyCI95'][1]:.0%}); "
          f"{s['attemptsCompleted']}/{s['attempts']} attempts submitted.")
    for r in result["solveRates"]:
        print(f"  {r['itemId']:<16} {r['correct']}/{r['runs']}  solvable={r['agentSolvable']}")
    print(f"wrote {out}/agent_runs.json, solve_rates.json, attack_summary.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
