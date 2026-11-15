// Repo-relative paths that still resolve when Mastra bundles this code into .mastra/output.
import { existsSync } from "node:fs";
import path from "node:path";

function findRepoRoot(): string {
  const starts = [process.env.UNPROMPTED_ROOT, process.cwd(), import.meta.dirname].filter(Boolean) as string[];
  for (const start of starts) {
    let dir = path.resolve(start);
    for (let i = 0; i < 8; i++) {
      if (existsSync(path.join(dir, "pnpm-workspace.yaml")) && existsSync(path.join(dir, "db/neon/schema.sql"))) return dir;
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  throw new Error("Can't find the repo root (pnpm-workspace.yaml + db/neon/schema.sql). Set UNPROMPTED_ROOT.");
}

export const REPO_ROOT = findRepoRoot();
export const SCHEMA_PATH = path.join(REPO_ROOT, "db/neon/schema.sql");
export const FIXTURES_DIR = path.join(REPO_ROOT, "data/fixtures");
export const LLM_CACHE_DIR = path.join(REPO_ROOT, "services/workflows/.cache/llm");
