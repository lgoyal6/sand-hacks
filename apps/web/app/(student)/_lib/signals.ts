// Per-item behavioral signals from telemetry, used only to decide whether to ask a follow-up
// question. Never shown to the student and never a verdict.
import "server-only";
import { promises as fs } from "node:fs";
import type { InteractionEvent } from "@unprompted/shared";
import { tiger } from "@/lib/db/tiger";
import { EVENTS_JSONL } from "@/lib/telemetry/server";

export interface ItemSignals {
  keys: number;
  pastes: number;
  pastedChars: number;
  pointerMoves: number;
  clicks: number;
  clicksWithoutMove: number;
  blurs: number;
  anomaly: number; // 0..1
}

async function loadEvents(attemptId: string, itemId: string): Promise<InteractionEvent[]> {
  const db = tiger();
  if (db) {
    try {
      const { rows } = await db.query<{ ts: Date; kind: string; payload: Record<string, unknown> }>(
        "select ts, kind, payload from interaction_events where attempt_id = $1 and item_id = $2 order by ts limit 5000",
        [attemptId, itemId],
      );
      return rows.map((r) => ({ ts: r.ts.toISOString(), attemptId, itemId, kind: r.kind as InteractionEvent["kind"], payload: r.payload }));
    } catch {
      /* fall through to jsonl */
    }
  }
  const text = await fs.readFile(EVENTS_JSONL, "utf8").catch(() => "");
  const out: InteractionEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.includes(attemptId)) continue;
    try {
      const e = JSON.parse(line) as InteractionEvent;
      if (e.attemptId === attemptId && e.itemId === itemId) out.push(e);
    } catch {}
  }
  return out;
}

export async function itemSignals(attemptId: string, itemId: string): Promise<ItemSignals> {
  const events = await loadEvents(attemptId, itemId);
  const s: ItemSignals = { keys: 0, pastes: 0, pastedChars: 0, pointerMoves: 0, clicks: 0, clicksWithoutMove: 0, blurs: 0, anomaly: 0 };
  let movedSinceClick = false;
  let nonMouse = false;
  for (const e of events) {
    const p = e.payload as Record<string, unknown>;
    if (e.kind === "key") s.keys++;
    else if (e.kind === "paste") {
      s.pastes++;
      s.pastedChars += Number(p.length) || 0;
    } else if (e.kind === "blur" && p.type !== "pagehide") s.blurs++;
    else if (e.kind === "pointer") {
      if (p.type === "down" && p.pointerType && p.pointerType !== "mouse") nonMouse = true;
      if (p.type === "move") {
        s.pointerMoves++;
        movedSinceClick = true;
      } else if (p.type === "click") {
        s.clicks++;
        if (!movedSinceClick && p.detail !== 0) s.clicksWithoutMove++;
        movedSinceClick = false;
      }
    }
  }
  // Note: with no telemetry at all (e.g. a touch device), every term stays 0.
  let a = 0;
  if (s.pastes > 0) a += 0.5;
  if (s.blurs >= 2) a += 0.25;
  // Touch and pen taps legitimately have no hover path, so this term is mouse-only.
  if (!nonMouse && s.clicks >= 1 && s.clicksWithoutMove === s.clicks && s.pointerMoves === 0) a += 0.5;
  s.anomaly = Math.min(1, a);
  return s;
}
