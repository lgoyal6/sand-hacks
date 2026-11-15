import { after, NextResponse } from "next/server";
import { anchor, fingerprint } from "@/lib/notary";
import { quizVersionRecord } from "@unprompted/shared";
import { neon } from "@/lib/db/neon";
import { createAttempt, listAttempts, type AttemptMode } from "../../quiz/_lib/attempts";
import { getQuiz, quizVoiceRequired } from "../../quiz/_lib/quizzes";
import { planProbes } from "../../_lib/policy";
import { getViewer } from "@/lib/auth/server";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { quizId?: string; mode?: AttemptMode; studentPseudonym?: string; consentAudio?: boolean; itemIds?: string[]; voiceRequired?: boolean };
  if (body.studentPseudonym !== undefined && !/^[\w-]{1,64}$/.test(body.studentPseudonym)) body.studentPseudonym = undefined;
  // Signed in: the pseudonym comes from the user id, never from the browser. The demo student may tag
  // runs (agent-/e2e-/test-) so the red-team runner and QA can label their sessions.
  const viewer = await getViewer();
  if (viewer) {
    const tag = body.studentPseudonym && /^(agent|e2e|test)-/.test(body.studentPseudonym) && viewer.demo ? body.studentPseudonym : null;
    body.studentPseudonym = tag ?? viewer.pseudonym;
  }
  const quiz = body.quizId ? await getQuiz(body.quizId) : null;
  if (!quiz) return NextResponse.json({ error: "quiz not found" }, { status: 404 });
  const mode: AttemptMode = body.mode === "graded" ? "graded" : "practice";
  // A focused session ("Practice this") plans probes over just its items.
  const focus = Array.isArray(body.itemIds) ? quiz.items.filter((i) => body.itemIds!.includes(i.id)).map((i) => i.id) : [];
  const { plan } = await planProbes(focus.length ? focus : quiz.items.map((i) => i.id), mode);
  // "Explanations: voice required" (graded only): the quiz setting, or the runner's ?voice=required (can only turn it ON).
  if (mode === "graded" && (body.voiceRequired === true || (await quizVoiceRequired(quiz.id)))) plan.push("voice:required");
  const attempt = await createAttempt({
    probePlan: plan,
    quiz,
    mode,
    studentPseudonym: body.studentPseudonym,
    consentAudio: body.consentAudio,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  // Notary (D; Dat approved anchoring attempts). quiz_version_sha256 = fingerprint(quizVersionRecord(...)) over exactly
  // the served items (B's appeal re-hashes the same way); it stays in Neon. The record includes answer keys, and with
  // public stems/choices a plain on-chain hash could be brute-forced into the key, so only a SALTED fingerprint
  // (server-only NOTARY_SALT) is anchored, and nothing is anchored until that salt exists. Runs after the response.
  if (attempt.store === "neon") {
    const sha = fingerprint(quizVersionRecord(quiz.id, quiz.items));
    const salt = process.env.NOTARY_SALT?.trim();
    after(async () => {
      const r = salt && salt.length >= 32 ? await anchor("quiz_version", fingerprint({ salt, record: quizVersionRecord(quiz.id, quiz.items) })) : null;
      await neon()
        ?.query("update attempt set quiz_version_sha256 = $2, quiz_version_anchor = $3::jsonb where id = $1", [
          attempt.id,
          sha,
          JSON.stringify(r ?? { status: "not_anchored", error: "NOTARY_SALT not set (anchoring held)" }),
        ])
        .catch((err) => console.warn("[notary] attempt fingerprint not stored:", (err as Error).message));
      if (r && r.status !== "anchored") console.warn(`[notary] attempt ${attempt.id} not anchored: ${r.error ?? "unknown"}`);
    });
  }
  return NextResponse.json({ attemptId: attempt.id, mode: attempt.mode, studentPseudonym: attempt.studentPseudonym });
}

// Runner-only results read for workstream A (grading agent runs server-side, without trusting the agent).
// Guarded by x-runner-token so a browser agent on the page can't read its own grades.
export async function GET(req: Request) {
  const expected = process.env.SANDBOX_RUNNER_TOKEN?.trim() || "dev-runner-token";
  if (req.headers.get("x-runner-token") !== expected) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const student = new URL(req.url).searchParams.get("student");
  if (!student || !/^[\w-]{1,64}$/.test(student)) return NextResponse.json({ error: "student required" }, { status: 400 });
  const attempts = await listAttempts({ student });
  return NextResponse.json({
    attempts: attempts.map((a) => ({
      attemptId: a.id,
      quizId: a.quizId,
      mode: a.mode,
      startedAt: a.startedAt,
      finishedAt: a.finishedAt ?? null,
      userAgent: a.userAgent ?? null,
      probesTriggered: a.probesTriggered ?? [],
      responses: a.responses.map((r) => ({ itemId: r.itemId, correct: r.correct, seconds: r.seconds, answeredAt: r.answeredAt })),
    })),
  });
}
