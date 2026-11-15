# lib/db (owner: C)

Server-only DB clients. `neon.ts` (DATABASE_URL) and `tiger.ts` (TIGER_DATABASE_URL) land here.
When a URL is missing, callers fall back to `data/fixtures/*.json` (see docs/CONTRACTS.md).
