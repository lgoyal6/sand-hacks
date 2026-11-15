// Spawn a services/workflows CLI the way `pnpm --filter @unprompted/workflows <script>` would (same cwd,
// same tsx flags), but without pnpm: some pnpm installs are a shebang-less shim that spawn() can't exec
// (ENOEXEC, "spawn Unknown system error -8"), which broke Canvas export, imports, live runs and grading.
import "server-only";
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams, type SpawnOptions } from "node:child_process";
import path from "node:path";
import { REPO_ROOT } from "@/lib/db/fixtures";

const WORKFLOWS = path.join(REPO_ROOT, "services/workflows");
const CLI = { ingest: "ingest", transform: "transform", qti: "qti", council: "council", leakscan: "leakscan" } as const;

export function spawnWorkflow(script: keyof typeof CLI, args: string[]): ChildProcessWithoutNullStreams;
export function spawnWorkflow(script: keyof typeof CLI, args: string[], opts: SpawnOptions): ChildProcess;
export function spawnWorkflow(script: keyof typeof CLI, args: string[], opts: SpawnOptions = {}): ChildProcess {
  return spawn(path.join(WORKFLOWS, "node_modules/.bin/tsx"), ["--env-file-if-exists=../../.env.local", `src/cli/${CLI[script]}.ts`, ...args], {
    env: process.env,
    ...opts,
    cwd: WORKFLOWS,
  });
}
