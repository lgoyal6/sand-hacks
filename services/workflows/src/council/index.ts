// Grading council (build plan 2.2 step 7, 4.5; the NYU method): three Gemini models score a
// think-aloud probe separately (0-4, quoted evidence), then each sees the others' scores and revises
// once; final = median. Content only, never fluency, grammar, accent or wording. The professor approves.
import { z } from "zod";
import type { Db } from "../db/types.js";
import type { JsonModel } from "../steps/llm.js";

export interface CouncilInput {
  probeId: string;
  objective: string;
  stem: string;
  choices?: { id: string; text: string }[];
  key: string;
  studentAnswer: string | null;
  correct: boolean | null;
  explanation: string;
  counterfactualPrompt: string | null;
  counterfactualAnswer: string;
}

export interface JudgeRound {
  score: number;
  evidence: string[];
  reason: string;
  droppedQuotes: number;
}
export interface Judgement {
  model: string;
  round1: JudgeRound;
  round2: JudgeRound;
}
export interface CouncilResult {
  panel: "three Gemini models";
  rubric: string;
  judges: Judgement[];
  finalScore: number;
  gradedAt: string;
}

export function rubricFor(objective: string) {
  return `Skill being checked: ${objective}
Score 0-4 on the CONTENT of the student's reasoning only:
4 = explains why the answer is right in terms of the skill, and the what-if answer follows from the same reasoning.
3 = sound reasoning with a small gap or imprecision; the what-if answer is mostly right.
2 = partly right: the right idea is present but the why is vague, or the what-if answer doesn't follow.
1 = little relevant reasoning (restates the answer, or a guess); the what-if answer is wrong or missing.
0 = no relevant content.
Ignore grammar, spelling, fluency, filler words, accent and transcription errors. Never reward length or confident tone.`;
}

const RoundSchema = z.object({
  score: z.number().int().min(0).max(4),
  evidence: z.array(z.string()).describe("1-3 short EXACT quotes from the student's own words that justify the score"),
  reason: z.string().describe("one or two sentences about the reasoning, not the writing"),
});

function context(i: CouncilInput) {
  const choices = i.choices?.map((c) => `  ${c.id}) ${c.text}`).join("\n") ?? "";
  return `QUESTION: ${i.stem}
${choices}
Correct answer: ${i.key}
Student's answer: ${i.studentAnswer ?? "(not recorded)"}${i.correct == null ? "" : i.correct ? " (correct)" : " (incorrect)"}

STUDENT'S EXPLANATION (their own words):
"""${i.explanation || "(none)"}"""

WHAT-IF FOLLOW-UP: ${i.counterfactualPrompt ?? "(none asked)"}
STUDENT'S WHAT-IF ANSWER:
"""${i.counterfactualAnswer || "(none)"}"""`;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s"'“”‘’.,;:!?()-]+/g, " ").trim();

/** Keep only quotes that really appear in the student's words (no invented evidence). */
export function checkQuotes(quotes: string[], studentText: string): { kept: string[]; dropped: number } {
  const hay = norm(studentText);
  const kept = quotes.map((q) => q.trim()).filter((q) => q.length >= 3 && hay.includes(norm(q)));
  return { kept, dropped: quotes.length - kept.length };
}

export function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export async function runCouncil(input: CouncilInput, judges: JsonModel[]): Promise<CouncilResult> {
  if (judges.length !== 3) throw new Error("the council needs exactly 3 judges");
  const rubric = rubricFor(input.objective);
  const studentText = `${input.explanation}\n${input.counterfactualAnswer}`;
  const system = "You grade a student's spoken or typed reasoning for a professor. Be fair and strict. Grade the reasoning, never the language.";
  const clean = (r: z.infer<typeof RoundSchema>): JudgeRound => {
    const q = checkQuotes(r.evidence, studentText);
    return { score: r.score, evidence: q.kept, reason: r.reason, droppedQuotes: q.dropped };
  };

  // Round 1: independent.
  const r1 = await Promise.all(
    judges.map(async (j, idx) =>
      clean(
        await j.json(`${rubric}\n\n${context(input)}\n\nScore it.`, RoundSchema, { temperature: 0.2, system, salt: `council:${input.probeId}:r1:${idx}` }),
      ),
    ),
  );
  // Round 2: each judge sees the others (anonymized) and may revise once.
  const r2 = await Promise.all(
    judges.map(async (j, idx) => {
      const others = r1
        .map((r, k) => (k === idx ? null : `Another grader: ${r.score}/4. Reason: ${r.reason}${r.evidence.length ? ` Evidence: ${r.evidence.map((e) => `"${e}"`).join("; ")}` : ""}`))
        .filter(Boolean)
        .join("\n");
      return clean(
        await j.json(
          `${rubric}\n\n${context(input)}\n\nYour first score: ${r1[idx]!.score}/4 (${r1[idx]!.reason}).\n${others}\n\nReconsider once. Keep your score unless the others point to something in the student's words you missed or misjudged. Then give your final score.`,
          RoundSchema,
          { temperature: 0.2, system, salt: `council:${input.probeId}:r2:${idx}` },
        ),
      );
    }),
  );
  return {
    panel: "three Gemini models",
    rubric,
    judges: judges.map((j, i) => ({ model: j.name, round1: r1[i]!, round2: r2[i]! })),
    finalScore: median(r2.map((r) => r.score)),
    gradedAt: new Date().toISOString(),
  };
}

// ---------------- Neon ----------------

/** Pull the student's explanation from a probe: the explanation field, else the student turns of the transcript. */
function studentWords(explanation: string | null, transcript: string | null) {
  if (explanation?.trim()) return explanation.trim();
  return (transcript ?? "")
    .split("\n")
    .filter((l) => /^Student\b/i.test(l))
    .map((l) => l.replace(/^Student[^:]*:\s*/i, ""))
    .join("\n")
    .trim();
}

export async function loadCouncilInput(db: Db, probeId: string): Promise<CouncilInput | null> {
  const { rows } = await db.query<{
    id: string; attempt_id: string; item_id: string; transcript: string | null; explanation: string | null;
    counterfactual_prompt: string | null; counterfactual_answer: string | null; stem: string; objective: string;
    choices_json: { id: string; text: string }[] | null; answer_key: string | string[];
  }>(
    `select p.id, p.attempt_id, p.item_id, p.transcript, p.explanation, p.counterfactual_prompt, p.counterfactual_answer,
            i.stem, i.objective, i.choices_json, i.answer_key
       from probe p join item i on i.id = p.item_id where p.id = $1`,
    [probeId],
  );
  const p = rows[0];
  if (!p) return null;
  const resp = (await db.query<{ answer: unknown; correct: boolean | null }>("select answer, correct from response where attempt_id = $1 and item_id = $2", [p.attempt_id, p.item_id])).rows[0];
  const explanation = studentWords(p.explanation, p.transcript);
  const counterfactualAnswer = (p.counterfactual_answer ?? "").trim();
  if (!explanation && !counterfactualAnswer) return null;
  const key = Array.isArray(p.answer_key) ? p.answer_key.join(", ") : String(p.answer_key);
  const ans = resp?.answer;
  return {
    probeId: p.id,
    objective: p.objective,
    stem: p.stem,
    ...(p.choices_json ? { choices: p.choices_json } : {}),
    key,
    studentAnswer: ans == null ? null : Array.isArray(ans) ? ans.join(", ") : String(ans),
    correct: resp?.correct ?? null,
    explanation,
    counterfactualPrompt: p.counterfactual_prompt,
    counterfactualAnswer,
  };
}

/** Store the council's result; professor_approved is left untouched (false until a professor clicks). */
export async function saveCouncil(db: Db, probeId: string, r: CouncilResult) {
  await db.query("update probe set council_scores_json = $2, final_score = $3 where id = $1", [probeId, JSON.stringify(r), r.finalScore]);
}
