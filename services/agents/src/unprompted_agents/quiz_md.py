"""Parse our quiz Markdown (data/quizzes/*.md) into a shared Quiz. Ids follow CONTRACTS.md:
quiz id = file slug, item id = <quizId>-q<n> with n the number written in the Markdown."""

from __future__ import annotations

import re
from pathlib import Path

ITEM = re.compile(r"^(\d+)\.\s*\[(mcq|multi|numeric|short)\]\s*(.+?)\s*$")
CHOICE = re.compile(r"^\s*-\s*([a-z])\)\s*(.+?)\s*$")
FIELD = re.compile(r"^\s*(answer|objective):\s*(.+?)\s*$")
ANSWER_MARK = re.compile(r"\s*\(answer\)\s*$")


def parse_quiz_md(path: str | Path, title: str | None = None) -> dict:
    path = Path(path)
    quiz_id = path.stem
    lines = path.read_text().splitlines()
    heading = next((ln[2:].strip() for ln in lines if ln.startswith("# ")), quiz_id)
    items: list[dict] = []
    cur: dict | None = None
    for ln in lines:
        if m := ITEM.match(ln):
            cur = {"id": f"{quiz_id}-q{m[1]}", "quizId": quiz_id, "type": m[2], "stem": m[3], "objective": ""}
            if m[2] in ("mcq", "multi"):
                cur["choices"], cur["_keys"] = [], []
            items.append(cur)
        elif cur and (m := CHOICE.match(ln)) and "choices" in cur:
            text = m[2]
            if ANSWER_MARK.search(text):
                cur["_keys"].append(m[1])
                text = ANSWER_MARK.sub("", text)
            cur["choices"].append({"id": m[1], "text": text})
        elif cur and (m := FIELD.match(ln)):
            cur["answerKey" if m[1] == "answer" else "objective"] = m[2]
        elif cur and ln.strip() and not ln.startswith(" ") and not ln.startswith("#"):
            cur["stem"] += " " + ln.strip()  # wrapped stem line
    for it in items:
        keys = it.pop("_keys", None)
        if keys is not None:
            it["answerKey"] = keys[0] if it["type"] == "mcq" else keys
        if "answerKey" not in it or it["answerKey"] in ([], ""):
            raise ValueError(f"{path.name}: {it['id']} has no answer")
        if it["type"] == "mcq" and len(keys or []) != 1:
            raise ValueError(f"{path.name}: {it['id']} mcq needs exactly one (answer)")
    if not items:
        raise ValueError(f"{path.name}: no items")
    return {"id": quiz_id, "courseId": "sandbox-course", "title": title or heading, "sourceFormat": "markdown", "items": items}
