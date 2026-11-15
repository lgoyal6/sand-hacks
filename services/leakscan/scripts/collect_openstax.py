"""Collect end-of-chapter exercises from OpenStax books for the Textbook Leak Index.

    ~/miniforge3/bin/python services/leakscan/scripts/collect_openstax.py --per-book 50

Exercise text is used ONLY as web-search strings (OpenStax: no ingestion into LLMs). This script never prints
exercise text; it writes it to services/leakscan/testsets/private/openstax-index.json (gitignored). Only ids,
chapters and URLs are committed (in the study results and the open dataset).
Polite: 1 request per second, a descriptive User-Agent, public pages only.
"""
from __future__ import annotations

import argparse
import html
import json
import random
import re
import sys
import time
import urllib.request
from pathlib import Path

BOOKS = {
    "introductory-statistics-2e": ("statistics", "Introductory Statistics 2e"),
    "calculus-volume-1": ("calculus", "Calculus Volume 1"),
    "calculus-volume-2": ("calculus", "Calculus Volume 2"),
    "biology-2e": ("biology", "Biology 2e"),
    "chemistry-2e": ("chemistry", "Chemistry 2e"),
    "college-physics-2e": ("physics", "College Physics 2e"),
    "principles-microeconomics-3e": ("microeconomics", "Principles of Microeconomics 3e"),
    "principles-macroeconomics-3e": ("macroeconomics", "Principles of Macroeconomics 3e"),
    "psychology-2e": ("psychology", "Psychology 2e"),
    "american-government-3e": ("government", "American Government 3e"),
}
# End-of-chapter page slugs vary by book.
EOC_UNUSED = re.compile(r"/pages/(\d+)-(homework|practice|review-questions|review-exercises|problems-exercises|problems|exercises|critical-thinking-questions|chapter-review|self-check-questions)\b")
UA = "UnpromptedLeakStudy/1.0 (education research; contact via repo)"
OUT = Path(__file__).resolve().parents[1] / "testsets" / "private" / "openstax-index.json"


def get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="ignore")


def text_of(fragment: str) -> str:
    fragment = re.sub(r"<math.*?</math>", " [math] ", fragment, flags=re.S)
    fragment = re.sub(r"<(script|style).*?</\1>", " ", fragment, flags=re.S)
    t = html.unescape(re.sub(r"<[^>]+>", " ", fragment))
    return re.sub(r"\s+", " ", t).strip()


def exercises(page_html: str):
    # Each exercise: <div data-type="exercise" id="..."> ... <span class="os-number">N</span> ... <div data-type="problem" ...> PROBLEM </div>
    for m in re.finditer(r'<div[^>]*data-type="exercise"[^>]*id="([^"]+)"(.*?)(?=<div[^>]*data-type="exercise"|\Z)', page_html, flags=re.S):
        ex_id, body = m.group(1), m.group(2)
        num = re.search(r'class="os-number"[^>]*>([^<]+)<', body)
        prob = re.search(r'data-type="problem"[^>]*>(.*?)(?:<div[^>]*data-type="solution"|<div[^>]*data-type="commentary"|\Z)', body, flags=re.S)
        if not prob:
            continue
        yield ex_id, (num.group(1).strip() if num else ""), text_of(prob.group(1))


KINDS = ["homework", "practice", "review-questions", "review-exercises", "problems-exercises", "exercises", "problems", "critical-thinking-questions", "chapter-review"]


def fetch_ok(url: str):
    time.sleep(1)
    try:
        h = get(url)
    except Exception:
        return None
    return h if 'data-type="exercise"' in h else None


def discover_pages(slug: str):
    """The TOC is client-rendered, so find which end-of-chapter page kinds this book uses on chapters 1-2,
    then walk chapters until two in a row have none. Returns [(page_slug, html)]."""
    kinds = []
    found = []
    for ch in (1, 2):
        for k in KINDS:
            h = fetch_ok(f"https://openstax.org/books/{slug}/pages/{ch}-{k}")
            if h:
                found.append((f"{ch}-{k}", h))
                if k not in kinds:
                    kinds.append(k)
    if not kinds:
        return []
    misses, ch = 0, 3
    while misses < 2 and ch <= 40:
        got = False
        for k in kinds:
            h = fetch_ok(f"https://openstax.org/books/{slug}/pages/{ch}-{k}")
            if h:
                found.append((f"{ch}-{k}", h))
                got = True
        misses = 0 if got else misses + 1
        ch += 1
    return found


def usable(t: str) -> bool:
    words = t.split()
    if len(words) < 10 or "[math]" in t and t.count("[math]") > 2:
        return False
    if re.search(r"\b(Figure|Table|shown below|graph below|following figure|the figure|the table)\b", t, flags=re.I):
        return False
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-book", type=int, default=50)
    ap.add_argument("--seed", type=int, default=11)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    items = []
    stats = {}
    for slug, (subject, title) in BOOKS.items():
        pages = discover_pages(slug)
        if not pages:
            print(f"{slug}: no end-of-chapter pages found", file=sys.stderr)
            stats[slug] = {"error": "no pages"}
            continue
        pool = []
        for p, h in pages:
            url = f"https://openstax.org/books/{slug}/pages/{p}"
            chap = p.split("-")[0]
            for ex_id, num, t in exercises(h):
                if usable(t):
                    pool.append({"id": f"openstax-{slug}-{ex_id}", "subject": subject, "book": title, "slug": slug, "chapter": chap, "number": num, "url": url, "stem": t[:300]})
        # Spread the sample across chapters: round-robin over chapters in a shuffled order.
        by_ch: dict[str, list] = {}
        for x in pool:
            by_ch.setdefault(x["chapter"], []).append(x)
        for v in by_ch.values():
            rng.shuffle(v)
        chosen = []
        while len(chosen) < args.per_book and any(by_ch.values()):
            for ch in sorted(by_ch, key=int):
                if by_ch[ch] and len(chosen) < args.per_book:
                    chosen.append(by_ch[ch].pop())
        items += chosen
        stats[slug] = {"eoc_pages": len(pages), "usable": len(pool), "chosen": len(chosen), "chapters": len(by_ch)}
        print(f"{slug}: {len(pages)} pages, {len(pool)} usable, {len(chosen)} chosen")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "name": "openstax-index",
        "attribution": "Exercises from OpenStax textbooks (openstax.org), used only as search strings.",
        "license": "OpenStax CC BY / CC BY-NC-SA. Do not send these stems to any LLM. Kept local (gitignored).",
        "stats": stats,
        "items": items,
    }, ensure_ascii=False, indent=1))
    print(f"wrote {len(items)} items to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
