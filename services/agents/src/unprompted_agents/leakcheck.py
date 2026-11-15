"""Bridge to D's leak check: `pnpm --filter @unprompted/leakscan scan --quiz - --json --max-items N`.
stdin: a Quiz (only id and stem are used); stdout: one line of ItemScan[] = [{itemId, findings, queries}]. It writes
no files. Stems shorter than 8 words make weak queries, so they are not sent (reported as not checked)."""

from __future__ import annotations

import json
import subprocess
import sys

from .cli import REPO

MIN_WORDS = 8


def leakcheck_via_d(questions: list[dict], max_items: int = 25) -> dict[str, list[dict]]:
    items = [{"id": q["id"], "stem": q["stem"], "type": "short", "answerKey": "", "objective": "", "quizId": "course-scan"}
             for q in questions if len(q["stem"].split()) >= MIN_WORDS][:max_items]
    if not items:
        return {}
    quiz = {"id": "course-scan", "courseId": "course-scan", "title": "Course site scan", "sourceFormat": "markdown",
            "items": items}
    p = subprocess.run(
        ["pnpm", "--silent", "--filter", "@unprompted/leakscan", "scan", "--quiz", "-", "--json",
         "--max-items", str(max_items)],
        input=json.dumps(quiz), capture_output=True, text=True, cwd=REPO, timeout=900,
    )
    if p.returncode == 2:
        raise RuntimeError("leak check unavailable: Bright Data keys missing (BRIGHTDATA_API_TOKEN / BRIGHTDATA_SERP_ZONE)")
    if p.returncode != 0:
        raise RuntimeError(f"leak check failed (exit {p.returncode}): {p.stderr[-400:]}")
    print(p.stderr.strip()[-300:], file=sys.stderr)
    line = next(ln for ln in reversed(p.stdout.splitlines()) if ln.strip().startswith("["))
    return {s["itemId"]: s.get("findings", []) for s in json.loads(line)}
