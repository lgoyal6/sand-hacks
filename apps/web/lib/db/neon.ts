// Neon Postgres client (app data). Server only. Null when DATABASE_URL is unset or blank.
import "server-only";
import { Pool } from "pg";

let pool: Pool | null | undefined;

// Same as Tiger: `sslmode=require` in a URL means libpq semantics (encrypt, don't verify) for node-postgres.
function normalize(url: string) {
  try {
    const u = new URL(url);
    if (u.searchParams.get("sslmode") === "require" && !u.searchParams.has("uselibpqcompat")) u.searchParams.set("uselibpqcompat", "true");
    return u.toString();
  } catch {
    return url;
  }
}

export function neon(): Pool | null {
  if (pool !== undefined) return pool;
  const url = process.env.DATABASE_URL?.trim();
  pool = url ? new Pool({ connectionString: normalize(url), max: 3 }) : null;
  pool?.on("error", (err) => console.error("[neon] idle client error:", err.message));
  return pool;
}
