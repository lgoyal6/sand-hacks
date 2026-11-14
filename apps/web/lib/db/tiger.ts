// Tiger Data (TimescaleDB) client. Server only. Null when TIGER_DATABASE_URL is unset or blank.
import "server-only";
import { Pool } from "pg";

let pool: Pool | null | undefined;

export function tiger(): Pool | null {
  if (pool !== undefined) return pool;
  const url = process.env.TIGER_DATABASE_URL?.trim();
  pool = url ? new Pool({ connectionString: url, max: 3, ssl: url.includes("sslmode=disable") ? undefined : { rejectUnauthorized: false } }) : null;
  return pool;
}
