// Transform agent-solvable items into verified variants (build plan 4.2).
//
//   pnpm --filter @unprompted/workflows transform                     # targets from A's solve_rates.json
//   pnpm --filter @unprompted/workflows transform --items sample-stats-q1 --n 3
//   ... --no-attack            run generate/solve/panel only; nothing can be "verified" without a re-attack
//   ... --assume-solve-rate 1  when A's solve_rates.json doesn't exist yet (recorded as an assumption)
//
// Writes data/fixtures/variants.json (VariantExperiment[]) and variants_events.jsonl (the live stream, for the studio demo).
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { REPO_ROOT } from "../paths.js";
import type { LeakFinding, SolveRate, VariantExperiment, VariantStrategy } from "@unprompted/shared";
import { loadQuiz, parseMarkdownQuiz, saveQuiz } from "../ingest/markdown.js";
import { ALL_STRATEGIES, runTransform } from "../runner.js";
import { selectTargets } from "../steps/index.js";
import type { TransformEvent } from "../steps/types.js";
import { buildContext } from "../context.js";

const ROOT = REPO_ROOT;
const FIX = path.join(ROOT, "data/fixtures");

const { values } = parseArgs({
  options: {
    quiz: { type: "string", default: "data/quizzes/sample-stats.md" },
    items: { type: "string" },
    n: { type: "string", default: "3" },
    strategies: { type: "string" },
    "no-attack": { type: "boolean", default: false },
    "attack-repeats": { type: "string", default: "3" },
    "attack-models": { type: "string" },
    "assume-solve-rate": { type: "string" },
    concurrency: { type: "string", default: "2" },
    events: { type: "string" },
  },
});

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

const quizFile = path.resolve(ROOT, values.quiz!);
const quizId = path.basename(quizFile, ".md");
const quiz = parseMarkdownQuiz(await readFile(quizFile, "utf8"), { quizId, courseId: "sandbox-course" });

// Which items to transform: agent-solvable (A) or leaked (D), unless --items says otherwise.
const rates = await readJson<SolveRate[]>(path.join(FIX, "solve_rates.json"));
const leaks = (await readJson<LeakFinding[]>(path.join(FIX, "leaks.json"))) ?? [];
const assumed = values["assume-solve-rate"] != null ? Number(values["assume-solve-rate"]) : null;
let picked;
try {
  picked = selectTargets(quiz, rates, leaks.map((l) => l.itemId), { itemIds: values.items?.split(",").map((s) => s.trim()), assumeSolveRate: assumed });
} catch (e) {
  console.error(String((e as Error).message));
  process.exit(1);
}
const { targets, notes } = picked;
if (!targets.length) {
  console.error(rates ? "No agent-solvable or leaked items to transform." : "No solve_rates.json yet; pass --items and --assume-solve-rate.");
  process.exit(1);
}

const eventsFile = values.events ? path.resolve(ROOT, values.events) : path.join(FIX, "variants_events.jsonl");
await mkdir(FIX, { recursive: true });
await mkdir(path.dirname(eventsFile), { recursive: true });
await writeFile(eventsFile, "");
const t0 = Date.now();
const log = async (e: TransformEvent) => {
  await appendFile(eventsFile, JSON.stringify({ t: Date.now() - t0, ...e }) + "\n");
  const id = ("experiment" in e ? e.experiment.id : "experimentId" in e ? e.experimentId : "") ?? "";
  const line =
    e.type === "stage"
      ? `... ${e.stage}`
      : e.type === "check"
      ? `${e.passed ? "pass" : "FAIL"} ${e.check}: ${e.detail}`
      : e.type === "rejected"
        ? `REJECTED: ${e.experiment.reasons.at(-1)}`
        : e.type === "verified"
          ? `VERIFIED: ${e.experiment.reasons.at(-1)}`
          : e.type === "proposed"
            ? `proposed (${e.experiment.strategy}): ${e.experiment.candidate.stem.slice(0, 110)}`
            : e.type === "error"
              ? `error: ${e.message}`
              : e.type === "attack_started"
                ? `re-attacking ${e.itemIds.length} candidates`
                : `re-attack done: ${e.solveRates.map((s) => `${s.itemId}=${s.correct}/${s.runs}`).join(" ")}`;
  console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s ${id.padEnd(22)} ${line}`);
};

let ctx;
try {
  ctx = await buildContext({
    noAttack: values["no-attack"],
    attackRepeats: Number(values["attack-repeats"]),
    attackModels: values["attack-models"],
    log: (s) => process.stderr.write(`  [attack] ${s}\n`),
  });
} catch (e) {
  console.error(String((e as Error).message));
  process.exit(1);
}
const { store, deps } = ctx;
console.log(`Transform ${targets.map((t) => t.item.id).join(", ")} on ${store.kind}; ${ctx.describe}`);
for (const n of notes) console.log(`NOTE ${n}`);

let result;
try {
  const main = await store.main();
  // Make sure the source quiz exists on main (idempotent), using what's there if it was imported before.
  await saveQuiz(main.db, quiz);
  const onMain = await loadQuiz(main.db, quiz.id);
  const pending: Promise<void>[] = [];
  result = await runTransform(
    store,
    onMain,
    targets,
    deps,
    {
      candidatesPerItem: Number(values.n),
      strategies: (values.strategies?.split(",") as VariantStrategy[] | undefined) ?? ALL_STRATEGIES,
      concurrency: Number(values.concurrency),
      onEvent: (e) => void pending.push(log(e)),
    },
  );
  await Promise.all(pending);
} finally {
  await store.close();
}

// Label assumptions on the experiments themselves so the studio can't present them as measured.
const experiments: VariantExperiment[] = result.experiments.map((e) => {
  const note = notes.find((n) => n.startsWith(`${e.itemId}:`));
  return note ? { ...e, reasons: [...e.reasons, note] } : e;
});

// Merge with earlier runs by id (PGlite main is in-memory, so the fixture is the durable record).
const prior = (await readJson<VariantExperiment[]>(path.join(FIX, "variants.json"))) ?? [];
const merged = [...prior.filter((p) => !experiments.some((e) => e.id === p.id)), ...experiments];
await writeFile(path.join(FIX, "variants.json"), JSON.stringify(merged, null, 2) + "\n");

const count = (s: string) => experiments.filter((e) => e.status === s).length;
console.log(
  `\n${experiments.length} candidates: ${count("verified")} verified, ${count("rejected")} rejected, ${count("proposed")} unverified (no re-attack). ` +
    `${((Date.now() - t0) / 1000).toFixed(0)}s. Probe priority (nothing survived): ${result.probePriority.join(", ") || "none"}`,
);
console.log(`Wrote data/fixtures/variants.json (${merged.length} total) and variants_events.jsonl`);
