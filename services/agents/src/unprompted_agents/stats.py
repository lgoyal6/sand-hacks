"""Solve-rate statistics (build plan 4.1). Output matches packages/shared SolveRate."""

from __future__ import annotations

import math
from collections import defaultdict

AGENT_SOLVABLE = 0.6


def wilson(correct: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """95% Wilson score interval; behaves sanely at 0/n and n/n, unlike the normal approximation."""
    if n == 0:
        return (0.0, 1.0)
    p = correct / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def solve_rates(runs: list[dict], item_ids: list[str] | None = None) -> list[dict]:
    """AgentRun[] -> SolveRate[], one per item, in item order. Runs where the agent crashed count as incorrect."""
    by_item: dict[str, list[bool]] = defaultdict(list)
    for r in runs:
        by_item[r["itemId"]].append(bool(r["correct"]))
    ids = item_ids or sorted(by_item)
    out = []
    for item_id in ids:
        results = by_item.get(item_id, [])
        n, c = len(results), sum(results)
        rate = c / n if n else 0.0
        out.append(
            {
                "itemId": item_id,
                "runs": n,
                "correct": c,
                "solveRate": round(rate, 4),
                "agentSolvable": n > 0 and rate >= AGENT_SOLVABLE,
            }
        )
    return out


def summary(runs: list[dict], attempts: list[dict]) -> dict:
    """Quiz-level numbers for the demo line 'agents solved X% (n runs), 95% CI'."""
    n, c = len(runs), sum(bool(r["correct"]) for r in runs)
    lo, hi = wilson(c, n)
    per_attempt = [a["score"] for a in attempts if a.get("score") is not None]
    by_cfg: dict[str, list[bool]] = defaultdict(list)
    for r in runs:
        by_cfg[f'{r["agent"]}|{r["model"]}'].append(bool(r["correct"]))
    return {
        "itemRuns": n,
        "itemCorrect": c,
        "accuracy": round(c / n, 4) if n else None,
        "accuracyCI95": [round(lo, 4), round(hi, 4)],
        "attempts": len(attempts),
        "attemptsCompleted": sum(1 for a in attempts if a.get("submitted")),
        "meanAttemptScore": round(sum(per_attempt) / len(per_attempt), 4) if per_attempt else None,
        "byAgentModel": {
            k: {"itemRuns": len(v), "accuracy": round(sum(v) / len(v), 4)} for k, v in sorted(by_cfg.items())
        },
    }


def excluded_by_model(metas: list[dict]) -> dict:
    """Runs that never produced a result, per model, with reasons. Provider limitations, not agent results: e.g.
    GMI's content filter stops gemini-3.5-flash-lite at our login page before the agent does anything."""
    out: dict[str, dict] = {}
    for m in metas:
        e = out.setdefault(m["model"], {"runs": 0, "excluded": 0, "reasons": {}})
        e["runs"] += 1
        if m.get("infraReason"):
            e["excluded"] += 1
            e["reasons"][m["infraReason"]] = e["reasons"].get(m["infraReason"], 0) + 1
    return {k: v for k, v in out.items() if v["excluded"]}
