"""Re-collect specific OpenStax exercises with the plain, robots-respecting collector (no AI in the loop).

    ~/miniforge3/bin/python services/leakscan/scripts/recollect.py

Reads exercise references (url + printed number) from the committed test sets, fetches each page once at
1 request/second, finds the exercise by its printed number, and writes the text to the gitignored
testsets/private/<name>.json. Prints counts and hashes only, never exercise text.
"""
from __future__ import annotations

import hashlib
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from collect_openstax import exercises, get  # noqa: E402

TS = Path(__file__).resolve().parents[1] / "testsets"
PRIVATE = TS / "private"


def number_of(item_id: str) -> str:
    # ids look like openstax-is2e-9.68 or openstax-statistics-4.72 -> "68" / "72"
    return item_id.rsplit(".", 1)[-1]


def main() -> int:
    PRIVATE.mkdir(parents=True, exist_ok=True)
    for name in ("openstax-is2e", "openstax-study"):
        ts = json.loads((TS / f"{name}.json").read_text())
        pages: dict[str, str] = {}
        out, missing = [], []
        for it in ts["items"]:
            url = it["url"]
            if url not in pages:
                time.sleep(1)
                try:
                    pages[url] = get(url)
                except Exception:
                    pages[url] = ""
            want = number_of(it["id"])
            match = next((t for _, num, t in exercises(pages[url]) if num == want), None)
            if not match:
                missing.append(it["id"])
                continue
            out.append({k: v for k, v in it.items() if k != "stem"} | {"stem": match[:300], "stemSha256": hashlib.sha256(match[:300].encode()).hexdigest()})
        (PRIVATE / f"{name}.json").write_text(json.dumps({**{k: v for k, v in ts.items() if k != "items"}, "collectedBy": "plain script (collect_openstax.py), robots.txt respected, no AI", "items": out}, ensure_ascii=False, indent=1))
        print(f"{name}: {len(out)} re-collected, {len(missing)} not found by number: {missing}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
