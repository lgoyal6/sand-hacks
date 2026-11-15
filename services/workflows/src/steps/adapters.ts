import { spawn } from "node:child_process";
import path from "node:path";
import type { Item, Quiz, SolveRate, VariantStrategy } from "@unprompted/shared";
import { z } from "zod";
import { answerText, extractFinal } from "./answers.js";
import { leakedNumbers, renderTablePng, tableText } from "./figure.js";
import { InfraError, type GeminiModel, type JsonModel } from "./llm.js";
import type { AttackResult, Attacker, Candidate, GeneratedCandidate, Generator, Judge, PanelVote, Solver, SolveResult } from "./types.js";

// ---------- shared prompt helpers ----------

export function renderItem(it: Pick<Item, "stem" | "type" | "choices"> & { figureText?: string }): string {
  const choices = it.choices?.map((c) => `  ${c.id}) ${c.text}`).join("\n") ?? "";
  const how =
    it.type === "mcq"
      ? "Choose exactly one option."
      : it.type === "multi"
        ? "Choose every correct option."
        : it.type === "numeric"
          ? "Give a single number (a fraction like 1/6 is fine)."
          : "Give a short answer.";
  const fig = it.figureText ? `\nThe figure shown with this question (an image; its content is):\n${it.figureText}\n` : "";
  return `[${it.type}] ${it.stem}\n${fig}${choices}\n(${how})`.trim();
}

const STRATEGY_BRIEF: Record<VariantStrategy, string> = {
  isomorphic:
    "ISOMORPHIC: same underlying skill and solution structure, but new numbers and a new surface context. The correct answer must differ from the original's, and no answer option may be copied from the original.",
  application:
    "APPLICATION: embed the skill in a concrete, realistic scenario (a lab, a clinic, a city dataset) where the student must recognize which concept applies before using it. Include only the data needed, plus at most one irrelevant detail.",
  find_error:
    "FIND THE ERROR: present a short worked solution (3-5 numbered steps) to a problem testing this skill, with exactly one step containing a conceptual or computational mistake. Ask which step is wrong, or what the corrected final answer is.",
  figure_dependency:
    "FIGURE ONLY: every number the student needs must appear ONLY in a small data table (2-5 rows) that will be shown as an IMAGE next to the question. Return that table in figureTable. The stem must refer to 'the table in the figure' and must NOT repeat any number from it. Require reading at least two values from the table.",
  counterfactual:
    "COUNTERFACTUAL: start from a stated baseline result, then ask what happens to it when one parameter changes (doubles, halves, flips sign, hits a boundary). The student must reason about the causal relationship, not recompute from scratch.",
};

// ---------- generator ----------

const CandidateSchema = z.object({
  stem: z.string().min(10),
  type: z.enum(["mcq", "multi", "numeric", "short"]),
  choices: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
  answerKey: z.string().describe("choice id for mcq; comma-separated ids for multi; the value for numeric/short"),
  rationale: z.string().describe("one or two sentences: why this still tests the same objective and why it is harder to look up"),
  figureTable: z
    .object({ title: z.string(), columns: z.array(z.string()), rows: z.array(z.array(z.union([z.string(), z.number()]))) })
    .optional()
    .describe("ONLY for the FIGURE ONLY strategy: the data table rendered as an image"),
});

export class GeminiGenerator implements Generator {
  constructor(private model: JsonModel) {}

  async generate(source: Item, strategy: VariantStrategy, attempt: number): Promise<GeneratedCandidate> {
    const prompt = `You rewrite quiz questions so they still test the SAME learning objective but are harder for an AI agent to answer by lookup or pattern matching.

Learning objective (must be unchanged): ${source.objective}

Original question:
${renderItem(source)}
Correct answer: ${answerText(source.answerKey)}

Strategy (attempt ${attempt}):
${STRATEGY_BRIEF[strategy]}

Rules:
- Keep the same objective and roughly the same difficulty for a student who has the skill.
- Exactly one defensible answer. Prefer mcq with 4 options labelled a-d, or numeric.
- Double-check your answer key by working the problem fully before you answer.
- No trick wording, no "all of the above", no reference to the original question.`;
    const out = await this.model.json(prompt, CandidateSchema, { temperature: 0.9 });
    const candidate = normalizeCandidate(out, source);
    if (strategy === "figure_dependency") {
      const t = out.figureTable;
      if (!t || !t.rows.length) throw new Error("figure strategy: generator returned no figure table");
      const leaked = leakedNumbers(candidate.stem, t);
      if (leaked.length) throw new Error(`figure strategy: the stem repeats numbers from the figure (${leaked.join(", ")}), so the image isn't the only source`);
      candidate.figure = { src: await renderTablePng(t), alt: "Figure for this question" };
      candidate.figureText = tableText(t);
    }
    return { candidate, rationale: out.rationale, generator: this.model.name };
  }
}

/** Force the objective, validate choices/key, and shape the key like the source's item type expects. */
export function normalizeCandidate(out: z.infer<typeof CandidateSchema>, source: Item): Candidate {
  const type = out.type;
  let answerKey: string | string[] = out.answerKey.trim();
  let choices = out.choices?.map((c) => ({ id: c.id.trim().toLowerCase().replace(/\)$/, ""), text: c.text.trim() }));
  if (type === "mcq" || type === "multi") {
    if (!choices || choices.length < 3) throw new Error("generator returned a choice question with fewer than 3 choices");
    const ids = new Set(choices.map((c) => c.id));
    const keys = answerKey
      .toLowerCase()
      .split(/[,\s]+/)
      .map((k) => k.replace(/[()]/g, ""))
      .filter(Boolean);
    if (keys.length === 0 || keys.some((k) => !ids.has(k))) throw new Error(`answer key "${out.answerKey}" is not one of the choices`);
    if (type === "mcq" && keys.length !== 1) throw new Error("mcq candidate has more than one key");
    answerKey = type === "mcq" ? keys[0]! : keys;
  } else {
    choices = undefined;
  }
  return {
    stem: out.stem.trim(),
    type,
    ...(choices ? { choices } : {}),
    answerKey,
    objective: source.objective,
    originalItemId: source.id,
  };
}

// ---------- solver (code interpreter) ----------

export class GeminiCodeSolver implements Solver {
  constructor(
    private model: GeminiModel,
    /** Set when a fallback solver exists: switch on quota instead of waiting. */
    private failFastOnQuota = false,
  ) {}

  /** Same prompt, for a model without the code tool (fallback path). */
  static prompt(candidate: Candidate, withCode: boolean) {
    return `Solve this quiz question.${withCode ? " Use Python code execution to compute or verify every quantitative step." : " Work every quantitative step carefully."}

${renderItem(candidate)}

End your reply with one line exactly like:
FINAL: <answer>
where <answer> is the option letter${candidate.type === "multi" ? "s, comma-separated" : ""}${candidate.type === "numeric" ? " or, for numeric questions, the number" : ""}.`;
  }

  async solve(candidate: Candidate, run = 0): Promise<SolveResult> {
    const prompt = GeminiCodeSolver.prompt(candidate, true);
    const { text, usedCode } = await this.model.withCode(prompt, { temperature: 0.7, salt: `run${run}`, failFastOnQuota: this.failFastOnQuota });
    const answer = extractFinal(text);
    if (!answer) throw new Error("solver reply had no FINAL: line");
    return { answer, usedCode, model: this.model.name };
  }
}

/**
 * Prefer the code-interpreter solver; if it is unavailable (quota), solve without code through
 * another model and report usedCode=false, so the check never claims code that didn't run.
 */
export class FallbackSolver implements Solver {
  constructor(
    private primary: Solver | null,
    private fallback: JsonModel | null,
  ) {}

  async solve(candidate: Candidate, run = 0): Promise<SolveResult> {
    if (this.primary) {
      try {
        return await this.primary.solve(candidate, run);
      } catch (e) {
        if (!this.fallback || !(e instanceof InfraError)) throw e;
      }
    }
    if (!this.fallback) throw new InfraError("no solver available (set GEMINI_API_KEY or GMI_API_KEY)");
    const out = await this.fallback.json(
      GeminiCodeSolver.prompt(candidate, false).replace(/End your reply[\s\S]*$/, "Reply with JSON: the final answer (option letter, or the number)."),
      z.object({ answer: z.string() }),
      { temperature: 0.7, salt: `run${run}` },
    );
    return { answer: out.answer.trim(), usedCode: false, model: this.fallback.name };
  }
}

// ---------- objective / ambiguity panel ----------

const VoteSchema = z.object({
  objectivePreserved: z.boolean().describe("true if a student needs the same skill to answer the new question"),
  unambiguous: z.boolean().describe("true if exactly one answer is defensible AND the stated key is that answer"),
  reason: z.string().describe("one sentence; name the specific problem if either is false"),
});

export class ModelJudge implements Judge {
  constructor(
    private model: JsonModel,
    readonly name: string = model.name,
    private temperature = 0.2,
  ) {}

  async vote(source: Item, candidate: Candidate): Promise<PanelVote> {
    const prompt = `You are reviewing a rewritten quiz question for a professor. Be strict: a false "true" puts a broken question in front of students.

Learning objective: ${source.objective}

ORIGINAL:
${renderItem(source)}
Key: ${answerText(source.answerKey)}

REWRITE:
${renderItem(candidate)}
Key: ${answerText(candidate.answerKey)}

1. objectivePreserved: does answering the rewrite require the same skill, at comparable difficulty for a student who has it? Changing context or numbers is fine; testing a different concept, or adding a big extra skill, is not.
2. unambiguous: is there exactly one defensible answer, and is the given key that answer? Work it out yourself.`;
    const v = await this.model.json(prompt, VoteSchema, { temperature: this.temperature });
    return { judge: this.name, ...v };
  }
}

// ---------- re-attack via Workstream A ----------

/**
 * Calls A's attack CLI (services/agents): pipes a shared Quiz on stdin, reads
 * {agentRuns, solveRates, summary} JSON from stdout. Needs the sandbox on :3101.
 */
export class CliAttacker implements Attacker {
  constructor(
    private opts: { repoRoot: string; repeats?: number; models?: string; agents?: string; timeoutMs?: number; log?: (s: string) => void },
  ) {}

  attack(quiz: Quiz, itemIds: string[]): Promise<AttackResult> {
    // Always through A's sandbox (macOS sandbox-exec): the browser agent runs model-written Python,
    // so it must not be able to read .env files, worktrees, quizzes/fixtures (answer keys) or run ps.
    const runner = path.join(this.opts.repoRoot, "services/agents/isolation/run.sh");
    const args = ["-", "--json", "--items", itemIds.join(","), "--repeats", String(this.opts.repeats ?? 3)];
    if (this.opts.models) args.push("--models", this.opts.models);
    if (this.opts.agents) args.push("--agents", this.opts.agents);
    return new Promise((resolve, reject) => {
      const child = spawn(runner, args, { cwd: this.opts.repoRoot, stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`attack timed out after ${this.opts.timeoutMs}ms`));
      }, this.opts.timeoutMs ?? 30 * 60_000);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => {
        err += d;
        this.opts.log?.(String(d).trimEnd());
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(`attack exited ${code}: ${err.slice(-800)}`));
        try {
          resolve(validSolveRates(JSON.parse(out) as AttackJson, itemIds));
        } catch (e) {
          reject(new Error(`attack output was not JSON: ${out.slice(0, 300)}`));
        }
      });
      child.stdin.end(JSON.stringify(quiz));
    });
  }
}

interface AttackJson {
  agentRuns: { id: string; itemId: string; correct: boolean }[];
  runs?: { runId: string; outcome?: "submitted" | "did_not_submit" | "wrong_quiz" | "infra"; submitted?: boolean; infraError?: boolean; isolated?: boolean }[];
  solveRates?: SolveRate[];
}

/**
 * A's runner scores a run that never submitted as wrong on every item ("the agent failing"), which is
 * right for a baseline. To VERIFY a variant we need evidence the agent couldn't solve it, so only runs
 * that submitted (and had no provider error) count; the rest are reported as excluded.
 * Trace that motivated this: run-0b06fdaf29 picked the right answers, hit max_steps, never submitted.
 */
export function validSolveRates(res: AttackJson, itemIds: string[]): AttackResult {
  const runs = res.runs ?? [];
  if (!runs.length) return { solveRates: res.solveRates ?? [] }; // older runner output: nothing to filter on
  const infra = (r: (typeof runs)[number]) => r.outcome === "infra" || r.infraError === true;
  const submitted = (r: (typeof runs)[number]) => (r.outcome ? r.outcome === "submitted" : r.submitted === true);
  // A run outside the sandbox could have read answer keys from disk: never evidence.
  const isolated = (r: (typeof runs)[number]) => r.isolated !== false;
  const valid = new Set(runs.filter((r) => submitted(r) && !infra(r) && isolated(r)).map((r) => r.runId));
  // A run that submitted a DIFFERENT quiz (A's outcome "wrong_quiz") never answered ours: excluded, counted apart.
  const wrongQuiz = runs.filter((r) => r.outcome === "wrong_quiz").length;
  const unsubmitted = runs.filter((r) => !infra(r) && !submitted(r) && r.outcome !== "wrong_quiz").length;
  const providerErrors = runs.filter(infra).length;
  const unisolated = runs.filter((r) => !isolated(r)).length;
  const by = new Map<string, { runs: number; correct: number }>(itemIds.map((id) => [id, { runs: 0, correct: 0 }]));
  for (const ar of res.agentRuns) {
    const runId = ar.id.split(":")[0]!;
    const b = by.get(ar.itemId);
    if (!b || !valid.has(runId)) continue;
    b.runs += 1;
    if (ar.correct) b.correct += 1;
  }
  const solveRates = [...by].map(([itemId, b]) => ({ itemId, runs: b.runs, correct: b.correct, solveRate: b.runs ? b.correct / b.runs : 0, agentSolvable: b.runs > 0 && b.correct / b.runs >= 0.6 }));
  return { solveRates, excluded: { unsubmitted, providerErrors, unisolated, wrongQuiz, total: runs.length } };
}
