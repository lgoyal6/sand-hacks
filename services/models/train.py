"""Train/evaluate the agent-likelihood model and write session flags.

  uv run train.py [--attempts PATH ...]

Reads Tiger `attempt_features` (TIGER_DATABASE_URL from the repo .env.local) and attempt metadata from
attempts.json files (C's runtime writes them; pass several with --attempts, e.g. other worktrees).
Writes reports/report-<ts>.json and data/fixtures/session_flags.json. Never invents data.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sys

import psycopg
from psycopg.rows import dict_row

from unprompted_models.agent_likelihood import evaluate, label_sessions, session_flags, to_json, _model

ROOT = pathlib.Path(__file__).resolve().parents[2]


def env(name: str) -> str | None:
    p = ROOT / ".env.local"
    if p.exists():
        for line in p.read_text().splitlines():
            if line.startswith(name + "="):
                v = line.split("=", 1)[1].strip().strip('"')
                return v or None
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--attempts", action="append", default=[str(ROOT / "data/fixtures/attempts.json")])
    args = ap.parse_args()

    url = env("TIGER_DATABASE_URL")
    if not url:
        print("TIGER_DATABASE_URL not set; nothing to train on.", file=sys.stderr)
        return 2
    with psycopg.connect(url) as conn:
        feats = conn.cursor(row_factory=dict_row).execute("select * from attempt_features").fetchall()

    attempts: dict[str, dict] = {}
    for p in args.attempts:
        try:
            for a in json.loads(pathlib.Path(p).read_text()):
                attempts[a["id"]] = a
        except FileNotFoundError:
            print(f"(no attempts file at {p})")

    sessions = label_sessions(feats, attempts)
    rep, _ = evaluate(sessions)
    print(to_json(rep))

    model = _model().fit([s.x for s in sessions], [s.label for s in sessions]) if rep.status == "ok" else None
    flags = session_flags(feats, model)
    ts = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    (pathlib.Path(__file__).parent / "reports" / f"report-{ts}.json").write_text(
        json.dumps({"report": json.loads(to_json(rep)), "tigerSessions": len(feats), "labelledSessions": len(sessions),
                    "scorer": "logistic-regression" if model else "behaviour-rule"}, indent=2)
    )
    (ROOT / "data/fixtures/session_flags.json").write_text(json.dumps(flags, indent=2) + "\n")
    print(f"{len(feats)} Tiger sessions, {len(sessions)} labelled; wrote session_flags.json ({'model' if model else 'behaviour rule'})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
