import { spawn } from "node:child_process";
import path from "node:path";
import type { Item, Quiz, SolveRate, VariantStrategy } from "@unprompted/shared";
import { z } from "zod";
import { answerText, extractFinal } from "./answers.js";
import type { GeminiModel, JsonModel } from "./llm.js";
import type { Attacker, Candidate, GeneratedCandidate, Generator, Judge, PanelVote, Solver, SolveResult } from "./types.js";

// ---------- shared prompt helpers ----------

export function renderItem(it: Pick<Item, "stem" | "type" | "choices">): string {
  const choices = it.choices?.map((c) => `  ${c.id}) ${c.text}`).join("\n") ?? "";
  const how =
    it.type === "mcq"
      ? "Choose exactly one option."
      : it.type === "multi"
        ? "Choose every correct option."
        : it.type === "numeric"
          ? "Give a single number (a fraction like 1/6 is fine)."
          : "Give a short answer.";
  return `[${it.type}] ${it.stem}\n${choices}\n(${how})`.trim();
}

const STRATEGY_BRIEF: Record<VariantStrategy, string> = {
  isomorphic:
    "ISOMORPHIC: same underlying skill and solution structure, but new numbers and a new surface context. The correct answer must differ from the original's, and no answer option may be copied from the original.",
  application:
    "APPLICATION: embed the skill in a concrete, realistic scenario (a lab, a clinic, a city dataset) where the student must recognize which concept applies before using it. Include only the data needed, plus at most one irrelevant detail.",
  find_error:
    "FIND THE ERROR: present a short worked solution (3-5 numbered steps) to a problem testing this skill, with exactly one step containing a conceptual or computational mistake. Ask which step is wrong, or what the corrected final answer is.",
  figure_dependency:
    "TABLE DEPENDENCY: put the needed values only in a small Markdown table inside the stem (not in the sentence), and require two dependent steps that use values from different rows.",
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
});

export class GeminiGenerator implements Generator {
  constructor(private model: GeminiModel) {}

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
  constructor(private model: GeminiModel) {}

  async solve(candidate: Candidate, run = 0): Promise<SolveResult> {
    const prompt = `Solve this quiz question. Use Python code execution to compute or verify every quantitative step.

${renderItem(candidate)}

End your reply with one line exactly like:
FINAL: <answer>
where <answer> is the option letter${candidate.type === "multi" ? "s, comma-separated" : ""}${candidate.type === "numeric" ? " or, for numeric questions, the number" : ""}.`;
    const { text, usedCode } = await this.model.withCode(prompt, { temperature: 0.7, salt: `run${run}` });
    const answer = extractFinal(text);
    if (!answer) throw new Error("solver reply had no FINAL: line");
    return { answer, usedCode, model: this.model.name };
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

/**
 * Three panel seats. Prefer different model families (Gemini + GMI open models).
 * Without GMI, fall back to three different Gemini models and say so in the seat names,
 * so the output never presents them as independent model families.
 */
export function buildPanel(gemini: JsonModel, others: JsonModel[], geminiFallbacks: JsonModel[]): { judges: Judge[]; independentFamilies: boolean } {
  if (others.length >= 2) {
    return { judges: [gemini, others[0]!, others[1]!].map((m) => new ModelJudge(m)), independentFamilies: true };
  }
  const seats = [gemini, ...others, ...geminiFallbacks].slice(0, 3);
  if (seats.length < 3) throw new Error("objective panel needs 3 seats");
  const sameFamily = seats.filter((m) => m.name.startsWith("gemini:")).length > 1;
  return {
    judges: seats.map((m) => new ModelJudge(m, sameFamily && m.name.startsWith("gemini:") ? `${m.name} (same family)` : m.name)),
    independentFamilies: !sameFamily,
  };
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

  attack(quiz: Quiz, itemIds: string[]): Promise<{ solveRates: SolveRate[] }> {
    const args = ["run", "--directory", path.join(this.opts.repoRoot, "services/agents"), "attack", "--quiz", "-", "--json"];
    args.push("--items", itemIds.join(","), "--repeats", String(this.opts.repeats ?? 3));
    if (this.opts.models) args.push("--models", this.opts.models);
    if (this.opts.agents) args.push("--agents", this.opts.agents);
    return new Promise((resolve, reject) => {
      const child = spawn("uv", args, { stdio: ["pipe", "pipe", "pipe"] });
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
          const res = JSON.parse(out) as { solveRates: SolveRate[] };
          resolve({ solveRates: res.solveRates });
        } catch (e) {
          reject(new Error(`attack output was not JSON: ${out.slice(0, 300)}`));
        }
      });
      child.stdin.end(JSON.stringify(quiz));
    });
  }
}
