// Tiger Data (TimescaleDB) client. Server only. Null when TIGER_DATABASE_URL is unset or blank, and
// also while Tiger is known to be unreachable (see the breaker below), so callers take their fallback
// immediately instead of waiting on a connect that will not succeed.
import "server-only";
import { Pool } from "pg";

let pool: Pool | null | undefined;

// A request must never wait on telemetry storage: fail a connect or a query fast. node-postgres has no
// connect timeout by default, so an unreachable host waits for the OS TCP timeout (about 75 s per
// attempt on macOS), and the student answer route made two such calls in a row.
const CONNECT_TIMEOUT_MS = 1500;
const QUERY_TIMEOUT_MS = 3000;
// After a connection-level failure, skip Tiger for a while; callers fall back to the jsonl sink.
const BREAKER_MS = 60_000;
let downUntil = 0;

const CONNECTION_ERROR = /timeout|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|terminated/i;

function trip(err: unknown) {
  const e = err as { code?: string; message?: string };
  if (CONNECTION_ERROR.test(`${e?.code ?? ""} ${e?.message ?? ""}`)) {
    if (Date.now() >= downUntil) console.error(`[tiger] unreachable (${e?.message || e?.code || "connect failed"}); skipping Tiger for ${BREAKER_MS / 1000}s`);
    downUntil = Date.now() + BREAKER_MS;
  }
}

/** For tests and diagnostics: is the breaker open right now? */
export function tigerDown() {
  return Date.now() < downUntil;
}

// Tiger hands out `?sslmode=require` URLs, meaning libpq semantics: encrypt, don't verify the chain.
// node-postgres treats `require` as verify-full and fails on Tiger's chain, so opt into libpq semantics.
function normalize(url: string) {
  try {
    const u = new URL(url);
    if (u.searchParams.get("sslmode") === "require" && !u.searchParams.has("uselibpqcompat")) u.searchParams.set("uselibpqcompat", "true");
    return u.toString();
  } catch {
    return url;
  }
}

export function tiger(): Pool | null {
  if (pool === undefined) {
    const url = process.env.TIGER_DATABASE_URL?.trim();
    pool = url ? new Pool({ connectionString: normalize(url), max: 3, connectionTimeoutMillis: CONNECT_TIMEOUT_MS, query_timeout: QUERY_TIMEOUT_MS }) : null;
    if (pool) {
      pool.on("error", (err) => {
        console.error("[tiger] idle client error:", err.message);
        trip(err);
      });
      // Every caller goes through pool.query; note connection failures there so the breaker opens.
      const query = pool.query.bind(pool) as (...args: unknown[]) => Promise<unknown>;
      (pool as unknown as { query: (...args: unknown[]) => Promise<unknown> }).query = (...args: unknown[]) =>
        query(...args).catch((err: unknown) => {
          trip(err);
          throw err;
        });
    }
  }
  if (!pool || Date.now() < downUntil) return null;
  return pool;
}
