// Demo resilience (owner: B). Every studio flow saves its last real result. When a backend is
// unreachable or slower than 8 s, or replay is forced (STUDIO_REPLAY=1, or a professor's ?replay=1
// cookie), the route serves that saved result and marks it with X-Studio-Replay: <recordedAt>,
// which the UI turns into a "Replaying a recorded run from <time>" badge. Never passed off as live.
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { FIXTURES_DIR } from "@/lib/db/fixtures";

const DIR = path.join(FIXTURES_DIR, "studio-replay");
export const REPLAY_TIMEOUT_MS = 8000;

export interface Snapshot<T> {
  recordedAt: string;
  data: T;
}

function file(flow: string, key: string) {
  const safe = `${flow}--${key}`.replace(/[^\w.-]+/g, "_").slice(0, 160);
  return path.join(DIR, `${safe}.json`);
}

export async function saveSnapshot<T>(flow: string, key: string, data: T) {
  await fs.mkdir(DIR, { recursive: true });
  const snap: Snapshot<T> = { recordedAt: new Date().toISOString(), data };
  const f = file(flow, key);
  await fs.writeFile(`${f}.tmp`, JSON.stringify(snap));
  await fs.rename(`${f}.tmp`, f);
}

export async function loadSnapshot<T>(flow: string, key: string): Promise<Snapshot<T> | null> {
  try {
    return JSON.parse(await fs.readFile(file(flow, key), "utf8")) as Snapshot<T>;
  } catch {
    return null;
  }
}

/** Replay forced for this request: env for the whole server, or the professor's studio_replay cookie. */
export function replayForced(req: Request): boolean {
  if (process.env.STUDIO_REPLAY?.trim() === "1") return true;
  return /(?:^|;\s*)studio_replay=1(?:;|$)/.test(req.headers.get("cookie") ?? "");
}

export class ReplayUnavailable extends Error {}

function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`slower than ${ms / 1000} s`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/**
 * Run the live call (8 s budget). Success is saved as the new snapshot. Failure, slowness, or forced
 * replay serves the last snapshot instead; with no snapshot, the live error propagates.
 */
export async function withReplay<T>(req: Request, flow: string, key: string, live: () => Promise<T>, ms = REPLAY_TIMEOUT_MS): Promise<{ data: T; replayedFrom?: string; reason?: string }> {
  if (replayForced(req)) {
    const snap = await loadSnapshot<T>(flow, key);
    if (snap) return { data: snap.data, replayedFrom: snap.recordedAt, reason: "replay mode" };
    throw new ReplayUnavailable(`Replay mode is on, but nothing was recorded yet for ${flow} (${key}).`);
  }
  try {
    const data = await timeout(live(), ms);
    await saveSnapshot(flow, key, data).catch(() => {});
    return { data };
  } catch (e) {
    const snap = await loadSnapshot<T>(flow, key);
    if (snap) return { data: snap.data, replayedFrom: snap.recordedAt, reason: (e as Error).message };
    throw e;
  }
}

/** JSON response, marked when it came from a recording. */
export function replayJson(r: { data: unknown; replayedFrom?: string; reason?: string }, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  if (r.replayedFrom) {
    headers.set("X-Studio-Replay", r.replayedFrom);
    if (r.reason) headers.set("X-Studio-Replay-Reason", r.reason.slice(0, 120));
  }
  return Response.json(r.data, { ...init, headers });
}
