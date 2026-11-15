"""Apply schema.sql + aggregates.sql in a throwaway schema, load synthetic sessions, check features, drop it.
Usage: uv run --with "psycopg[binary]" db/tiger/scripts/test_aggregates.py   (never touches the live tables)"""
import json, pathlib, random, sys
from datetime import datetime, timedelta, timezone
import psycopg

sys.path.insert(0, str(pathlib.Path(__file__).parent))
HERE = pathlib.Path(__file__).resolve().parent
TIGER = HERE.parent

def url():
    for line in (HERE.parents[2] / ".env.local").read_text().splitlines():
        if line.startswith("TIGER_DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"')

S = "d_agg_test"
T0 = datetime(2026, 11, 14, 20, 0, tzinfo=timezone.utc)
rows = []
def ev(att, item, ms, kind, **payload):
    rows.append((T0 + timedelta(milliseconds=ms), att, item, kind, json.dumps({"t": ms, **payload})))

random.seed(7)
# Human: types an answer with irregular rhythm, moves the mouse before clicking, alt-tabs once.
ev("human", None, 0, "focus", type="session_start", webdriver=False)
ms = 1000
for item in ("q1", "q2"):
    ev("human", item, ms, "answer", type="item_shown", index=0); ms += 2500
    for _ in range(12):
        ms += random.randint(80, 420); ev("human", item, ms, "key", cls="char", dt=random.randint(80, 420), trusted=True)
    for _ in range(4):
        ms += 200; ev("human", item, ms, "pointer", type="move", points=[[10, 10, ms]] * 8)
    ms += 150; ev("human", item, ms, "pointer", type="click", x=1, y=1, trusted=True)
    ms += 50; ev("human", item, ms, "answer", type="change", value="b", sinceShownMs=3000)
    ms += 900; ev("human", item, ms, "blur", type="window"); ms += 4000; ev("human", item, ms, "focus", type="window")
    ms += 600; ev("human", item, ms, "pointer", type="move", points=[[5, 5, ms]] * 5)
    ms += 200; ev("human", item, ms, "answer", type="submit", value="b", seconds=9)
# CDP agent: clicks with no pointer movement, trusted=true, webdriver=false (looks human to flags).
ev("cdp", None, 0, "focus", type="session_start", webdriver=False)
ms = 1000
for item in ("q1", "q2"):
    ms += 3000; ev("cdp", item, ms, "pointer", type="down", x=300, y=400, trusted=True)
    ms += 40; ev("cdp", item, ms, "pointer", type="click", x=300, y=400, trusted=True)
    ms += 10; ev("cdp", item, ms, "answer", type="change", value="b")
    ms += 3000; ev("cdp", item, ms, "pointer", type="click", x=600, y=700, trusted=True)
    ms += 10; ev("cdp", item, ms, "answer", type="submit", value="b")
# JS agent: answers appear with zero input events at all.
ev("jsfill", None, 0, "focus", type="session_start", webdriver=False)
ms = 1000
for item in ("q1", "q2"):
    ms += 5000; ev("jsfill", item, ms, "answer", type="change", value="b")
    ms += 100; ev("jsfill", item, ms, "answer", type="submit", value="b")
# Probe timing
rows_pt = [(T0 + timedelta(seconds=60), "p1", "cf_prompt", 0), (T0 + timedelta(seconds=61.4), "p1", "cf_speech_start", 1400)]

with psycopg.connect(url(), autocommit=True) as conn:
    cur = conn.cursor()
    cur.execute(f"drop schema if exists {S} cascade; create schema {S}")
    cur.execute(f"set search_path = {S}, public")
    try:
        cur.execute((TIGER / "schema.sql").read_text())
        cur.execute((TIGER / "aggregates.sql").read_text())
        cur.executemany("insert into interaction_events (ts, attempt_id, item_id, kind, payload) values (%s,%s,%s,%s,%s)", rows)
        cur.executemany("insert into probe_timing (ts, probe_id, phase, ms) values (%s,%s,%s,%s)", rows_pt)
        cur.execute("""select attempt_id, items, keys, clicks, clicks_no_move, round(click_no_move_ratio::numeric,2) cnm,
                              answers, answers_without_item_input awi, answers_in_dead_range adr,
                              round(key_dt_cv::numeric,2) cv, ms_away, webdriver
                       from attempt_features order by attempt_id""")
        cols = [d.name for d in cur.description]; res = {r[0]: dict(zip(cols, r)) for r in cur.fetchall()}
        for r in res.values(): print(r)
        cur.execute("select attempt_id, count(*) from attempt_dead_ranges group by 1 order by 1"); print("dead ranges:", cur.fetchall())
        cur.execute("select probe_id, cf_latency_ms from probe_latency"); print("probe latency:", cur.fetchall())
        h, c, j = res["human"], res["cdp"], res["jsfill"]
        assert h["clicks_no_move"] == 0 and h["awi"] == 0 and h["keys"] == 24, h
        assert c["cnm"] == 1 and c["webdriver"] is False, c
        assert j["awi"] == j["answers"] == 4 and j["keys"] == 0, j
        assert h["ms_away"] > 0, h
        print("OK: human, CDP and JS-fill sessions separate on behaviour; flags alone would not.")
    finally:
        cur.execute(f"drop schema if exists {S} cascade")
