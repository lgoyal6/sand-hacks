// Tiger Data (TimescaleDB) client. Server only. Null when TIGER_DATABASE_URL is unset or blank.
import "server-only";
import { Pool } from "pg";

let pool: Pool | null | undefined;

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
  if (pool !== undefined) return pool;
  const url = process.env.TIGER_DATABASE_URL?.trim();
  pool = url ? new Pool({ connectionString: normalize(url), max: 3 }) : null;
  pool?.on("error", (err) => console.error("[tiger] idle client error:", err.message));
  return pool;
}
