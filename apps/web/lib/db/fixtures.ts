// Fixture storage for when a DB URL is missing (docs/CONTRACTS.md, "Data when keys are missing").
// Server only. Paths resolve to <repo>/data regardless of which directory `next` was started from.
import "server-only";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = path.dirname(dir);
  }
  return path.resolve(start, "../..");
}

export const REPO_ROOT = findRepoRoot(process.cwd());
export const DATA_DIR = path.join(REPO_ROOT, "data");
export const FIXTURES_DIR = path.join(DATA_DIR, "fixtures");

export function fixturePath(name: string) {
  return path.join(FIXTURES_DIR, name);
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

// Serialize writes per file so concurrent requests in one dev server don't clobber each other.
const locks = new Map<string, Promise<unknown>>();
export async function updateJson<T>(file: string, fallback: T, fn: (cur: T) => T | Promise<T>): Promise<T> {
  const prev = locks.get(file) ?? Promise.resolve();
  const next = prev.then(async () => {
    const cur = await readJson(file, fallback);
    const out = await fn(cur);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(out, null, 2) + "\n");
    await fs.rename(tmp, file);
    return out;
  });
  locks.set(file, next.catch(() => undefined));
  return next;
}

export async function appendJsonl(file: string, rows: unknown[]) {
  if (!rows.length) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}
