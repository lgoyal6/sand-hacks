"""Re-apply the current infra-error rule (attack.infra_reason) to runs already in the fixtures, then recompute
agent_runs, solve_rates and the summaries from the kept runs. Nothing is invented: excluded runs stay listed in each
summary's runs[] with infraReason, and their AgentRuns are dropped.

  uv run python -m unprompted_agents.reclassify [--out-dir data/fixtures]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .attack import infra_reason
from .cli import REPO, _dump, _load
from .stats import solve_rates, summary


def reclassify(out: Path) -> dict:
    summaries = _load(out / "attack_summaries.json", {})
    runs = _load(out / "agent_runs.json", [])
    rates = _load(out / "solve_rates.json", [])
    report = {}
    for quiz_id, s in summaries.items():
        metas = s["runs"]
        for m in metas:
            m["infraReason"] = infra_reason(m["status"], m.get("error"), m["submitted"])
            m["infraError"] = m["infraReason"] is not None
            m["outcome"] = "submitted" if m["submitted"] else ("infra" if m["infraError"] else "did_not_submit")
        bad = {m["runId"] for m in metas if m["outcome"] != "submitted"}
        mine = [r for r in runs if r["quizId"] == quiz_id]
        item_ids = list(dict.fromkeys(r["itemId"] for r in mine))
        kept = [r for r in mine if r["id"].split(":")[0] not in bad]
        runs = [r for r in runs if r["quizId"] != quiz_id] + kept
        rates = [r for r in rates if r["itemId"] not in item_ids] + solve_rates(kept, item_ids)
        good = [m for m in metas if m["outcome"] == "submitted"]
        reasons = {}
        for m in metas:
            if m["infraReason"]:
                reasons[m["infraReason"]] = reasons.get(m["infraReason"], 0) + 1
        summaries[quiz_id] = {**s, **summary(kept, good), "quizId": quiz_id, "infraErrors": sum(m["infraError"] for m in metas),
                              "didNotSubmit": sum(m["outcome"] == "did_not_submit" for m in metas),
                              "infraReasons": reasons, "runs": metas}
        report[quiz_id] = {k: summaries[quiz_id][k] for k in ("itemRuns", "itemCorrect", "accuracy", "accuracyCI95", "infraErrors")}
    _dump(out / "agent_runs.json", runs)
    _dump(out / "solve_rates.json", rates)
    _dump(out / "attack_summaries.json", summaries)
    if "sample-stats" in summaries:
        _dump(out / "attack_summary.json", summaries["sample-stats"])
    return report


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default=str(REPO / "data" / "fixtures"))
    for q, r in reclassify(Path(ap.parse_args().out_dir)).items():
        print(q, json.dumps(r))
