"""Publish the Textbook Leak Index as open data (links only, no exercise text, no snippets).

    ~/miniforge3/bin/python services/leakscan/scripts/publish_index.py

Reads the newest results/study-openstax-index-*.json and writes data/open/leak-index-2026-11.{json,csv}.
Also strips snippets and queries from that results file in place (it is committed; exercise text must not be).
"""
from __future__ import annotations

import csv
import glob
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
RES = sorted(glob.glob(str(ROOT / "services/leakscan/results/study-openstax-index-*.json")))[-1]


def main() -> None:
    d = json.loads(Path(RES).read_text())
    s = d["summary"]
    items = d.get("items", [])
    errored = {q["itemId"] for q in d.get("queries", []) if q.get("error")}
    found_rows = []
    hit_ids = set()
    for f in d["findings"]:
        if not f.get("studySite"):
            continue
        mt = "partial" if f["partial"] else ("exact" if f["matchScore"] >= 1 else "strong")
        if not f["partial"]:
            hit_ids.add(f["itemId"])
        found_rows.append({"exercise_id": f["itemId"], "subject": f["subject"], "book": f.get("book", ""), "chapter": f.get("chapter", ""), "site": f["site"], "result_url": f["url"], "match_type": mt, "match_score": f["matchScore"], "answer_mentioned_in_snippet": f["answerSignal"]})
    url_by_id = {i["id"]: i["url"] for i in items}
    for r in found_rows:
        r["exercise_url"] = url_by_id.get(r["exercise_id"], "")
    rows = found_rows[:]
    for i in items:
        if i["id"] not in {r["exercise_id"] for r in found_rows}:
            rows.append({"exercise_id": i["id"], "subject": i["subject"], "book": i["book"], "chapter": i.get("chapter", ""), "site": "", "result_url": "", "match_type": "not_found", "match_score": "", "answer_mentioned_in_snippet": "", "exercise_url": i["url"]})
    for r in rows:
        r["query_error"] = r["exercise_id"] in errored and r["match_type"] == "not_found"
    rows.sort(key=lambda r: (r["book"], r["exercise_id"], r["site"]))
    # Three honest levels (see docs/leak-study.md): strict = the snippet shows the exercise's ask;
    # exact phrase = strict, or a homework page whose snippet contains an exact 8-12 word window of the exercise;
    # any overlap = text overlap >= 0.5 on a homework site (an upper bound that includes false positives).
    import math
    def wilson(k, n):
        if not n: return [0, 0]
        z = 1.96; p = k / n; den = 1 + z * z / n; c = p + z * z / (2 * n); r = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
        return [round((c - r) / den * 100, 1), round((c + r) / den * 100, 1)]
    study = [f for f in d["findings"] if f.get("studySite")]
    strict = {f["itemId"] for f in study if not f["partial"]}
    exact = strict | {f["itemId"] for f in study if f["partial"] and f["matchScore"] >= 1.0}
    anyo = {f["itemId"] for f in study if f["matchScore"] >= 0.5}
    n = len(items)
    levels = {name: {"found": len(sset), "pct": round(len(sset) / n * 100, 1), "ci95": wilson(len(sset), n)} for name, sset in (("strict", strict), ("exact_phrase", exact), ("any_overlap", anyo))}
    by_book_levels = {}
    for b in sorted({i["book"] for i in items}):
        ids = {i["id"] for i in items if i["book"] == b}
        by_book_levels[b] = {name: {"found": len(ids & sset), "pct": round(len(ids & sset) / len(ids) * 100, 1), "ci95": wilson(len(ids & sset), len(ids))} for name, sset in (("strict", strict), ("exact_phrase", exact), ("any_overlap", anyo))}
    for r in rows:
        r["level"] = "strict" if r["exercise_id"] in strict else "exact_phrase" if r["exercise_id"] in exact else "any_overlap" if r["exercise_id"] in anyo else "not_found"

    cols = ["exercise_id", "subject", "book", "chapter", "exercise_url", "site", "result_url", "match_type", "match_score", "answer_mentioned_in_snippet", "query_error", "level"]
    out = ROOT / "data/open"
    with open(out / "leak-index-2026-11.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows([{c: r.get(c, "") for c in cols} for r in rows])
    pub = {
        "title": "Textbook Leak Index (Nov 2026)",
        "collected": s["startedAt"][:10],
        "exercises": s["exercises"],
        "found_on_study_sites": s["foundOnStudySites"],
        "pct_found": s["pctFoundOnStudySites"],
        "ci95": s.get("ci95"),
        "answer_mentioned_in_snippet": s["withAnswerSignalInSnippet"],
        "queries": s["queries"],
        "query_errors": s["queryErrors"],
        "unknown_due_to_errors": sum(1 for r in rows if r["query_error"]),
        "levels": levels,
        "by_book_levels": by_book_levels,
        "by_book": s["byBook"],
        "by_chapter": s["byChapter"],
        "by_site": s["bySite"],
        "match_score_histogram": s["matchScoreHistogram"],
        "method": s["method"],
        "collection": "Exercise text collected by a plain, non-AI script that respects openstax.org robots.txt (1 request/second); used only as search queries; never stored in this dataset or in git.",
        "caveats": s["caveats"],
        "rows": rows,
    }
    (out / "leak-index-2026-11.json").write_text(json.dumps(pub, indent=1))
    # Strip text-bearing fields from the committed results file.
    for f in d["findings"]:
        f.pop("snippet", None)
        f.pop("query", None)
    d["queries"] = [{k: v for k, v in q.items() if k in ("itemId", "pass", "results", "error")} for q in d.get("queries", [])]
    Path(RES).write_text(json.dumps(d, indent=2))
    print(f"published {len(rows)} rows; {s['foundOnStudySites']}/{s['exercises']} found ({s['pctFoundOnStudySites']}%)")


if __name__ == "__main__":
    main()
