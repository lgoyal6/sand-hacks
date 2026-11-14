// Telemetry sink. Writes InteractionEvents to Tiger's `interaction_events` hypertable,
// falling back to data/fixtures/interaction_events.jsonl when Tiger is missing or failing.
import "server-only";
import type { InteractionEvent, InteractionKind } from "@unprompted/shared";
import { appendJsonl, fixturePath, DATA_DIR } from "@/lib/db/fixtures";
import { tiger } from "@/lib/db/tiger";
import path from "node:path";

const KINDS = new Set<InteractionKind>(["key", "paste", "focus", "blur", "pointer", "scroll", "select", "answer"]);
export const EVENTS_JSONL = fixturePath("interaction_events.jsonl");

export function sanitize(raw: unknown[], attemptId: string): InteractionEvent[] {
  const out: InteractionEvent[] = [];
  for (const r of raw.slice(0, 1000)) {
    const e = r as Partial<InteractionEvent>;
    if (!e || !KINDS.has(e.kind as InteractionKind)) continue;
    const ts = new Date(e.ts ?? Date.now());
    if (Number.isNaN(ts.getTime())) continue;
    out.push({
      ts: ts.toISOString(),
      attemptId, // trust the URL's attempt, not the body
      itemId: typeof e.itemId === "string" ? e.itemId.slice(0, 128) : undefined,
      kind: e.kind as InteractionKind,
      payload: e.payload && typeof e.payload === "object" ? e.payload : {},
    });
  }
  return out;
}

export async function writeEvents(events: InteractionEvent[]): Promise<"tiger" | "jsonl"> {
  if (!events.length) return "jsonl";
  const db = tiger();
  if (db) {
    try {
      const cols = 5;
      const values: unknown[] = [];
      const rows = events.map((e, i) => {
        values.push(e.ts, e.attemptId, e.itemId ?? null, e.kind, JSON.stringify(e.payload));
        const b = i * cols;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}::jsonb)`;
      });
      await db.query(`insert into interaction_events (ts, attempt_id, item_id, kind, payload) values ${rows.join(",")}`, values);
      return "tiger";
    } catch (err) {
      console.error("[telemetry] Tiger insert failed, falling back to jsonl:", (err as Error).message);
    }
  }
  await appendJsonl(EVENTS_JSONL, events);
  return "jsonl";
}

// rrweb recordings are large: keep them out of git (data/sessions/ is gitignored).
export async function writeRecording(attemptId: string, events: unknown[]) {
  await appendJsonl(path.join(DATA_DIR, "sessions", `${attemptId.replace(/[^\w-]/g, "")}.rrweb.jsonl`), events);
}
