"""Run SQL against Tiger (TIGER_DATABASE_URL). Usage: uv run --with "psycopg[binary]" db/tiger/scripts/sql.py <file.sql | -c "SQL">"""
import os, sys, pathlib
import psycopg

def env_url():
    url = os.environ.get("TIGER_DATABASE_URL")
    if url:
        return url
    p = pathlib.Path(__file__).resolve().parents[3] / ".env.local"
    for line in p.read_text().splitlines():
        if line.startswith("TIGER_DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"')
    sys.exit("TIGER_DATABASE_URL not set")

def main():
    sql = sys.argv[2] if sys.argv[1] == "-c" else pathlib.Path(sys.argv[1]).read_text()
    with psycopg.connect(env_url(), autocommit=True) as conn:
        cur = conn.cursor()
        cur.execute(sql)
        while True:
            if cur.description:
                cols = [d.name for d in cur.description]
                rows = cur.fetchall()
                print(" | ".join(cols))
                for r in rows[:50]:
                    print(" | ".join(str(x) for x in r))
                print(f"({len(rows)} rows)")
            if not cur.nextset():
                break

main()
