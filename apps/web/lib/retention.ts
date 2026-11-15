// Recording and transcript retention (server only).
// Policy: the ElevenLabs call (audio + their copy of the transcript) is deleted once our transcript and word
// timestamps are saved; probe.audio_deleted_at records when. Our transcript stays until the professor deletes
// it on the student page; probe.transcript_deleted_at records when.
import "server-only";
import { neon } from "@/lib/db/neon";
import { deleteConversation, getConversation, voiceConfigured } from "@/app/(student)/_lib/elevenlabs";

let columns: Promise<boolean> | null = null;
/** Same columns as db/neon/schema.sql, added here too so the web app doesn't wait for a schema run. */
export function ensureRetentionColumns(): Promise<boolean> {
  const db = neon();
  if (!db) return Promise.resolve(false);
  columns ??= db
    .query("alter table probe add column if not exists audio_deleted_at timestamptz, add column if not exists transcript_deleted_at timestamptz")
    .then(() => true)
    .catch((err) => {
      console.warn("[retention] couldn't add the retention columns:", (err as Error).message);
      columns = null; // retry next time
      return false;
    });
  return columns;
}

/** Delete the ElevenLabs call for a probe and record it. Never throws; false if it didn't happen. */
export async function deleteProbeAudio(probeId: string, conversationId: string): Promise<boolean> {
  try {
    if (!(await deleteConversation(conversationId))) {
      console.warn(`[retention] ElevenLabs refused to delete ${conversationId} (probe ${probeId})`);
      return false;
    }
  } catch (err) {
    console.warn(`[retention] ElevenLabs delete failed for ${conversationId} (probe ${probeId}):`, (err as Error).message);
    return false;
  }
  const db = neon();
  if (db && (await ensureRetentionColumns())) {
    await db.query("update probe set audio_deleted_at = now() where id = $1 and audio_deleted_at is null", [probeId]).catch((err) => {
      console.warn(`[retention] audio deleted but not recorded for probe ${probeId}:`, (err as Error).message);
    });
  }
  return true;
}

/**
 * Retry sweep: voice probes whose transcript is saved (or was deleted by the professor) but whose call audio
 * wasn't deleted, e.g. the call wasn't final when the transcript was fetched, or ElevenLabs failed. Run lazily
 * when a professor opens a student page (in after(), so it never slows the page). A few calls per run.
 */
export async function sweepProbeAudio(attemptIds: string[], limit = 5): Promise<number> {
  const db = neon();
  if (!db || !attemptIds.length || !voiceConfigured() || !(await ensureRetentionColumns())) return 0;
  let done = 0;
  try {
    const { rows } = await db.query<{ id: string; conversation_id: string }>(
      `select id, conversation_id from probe
        where attempt_id = any($1) and conversation_id is not null and audio_deleted_at is null
          and (transcript is not null or transcript_deleted_at is not null)
        order by created_at limit $2`,
      [attemptIds, limit],
    );
    for (const r of rows) {
      let conv: Awaited<ReturnType<typeof getConversation>> | null = null;
      try {
        conv = await getConversation(r.conversation_id, 0);
      } catch (err) {
        if (/another agent/.test((err as Error).message)) continue; // never touch a call that isn't ours
      }
      if (!conv) {
        // Not found at ElevenLabs: the delete returns ok for an already-deleted call, which records it.
        if (await deleteProbeAudio(r.id, r.conversation_id)) done++;
        continue;
      }
      if (conv.status !== "done" && conv.status !== "failed") continue; // still processing: next sweep
      if (await deleteProbeAudio(r.id, r.conversation_id)) done++;
    }
  } catch (err) {
    console.warn("[retention] audio sweep failed:", (err as Error).message);
  }
  return done;
}
