// Studio data (owner: B). Reads Neon main when DATABASE_URL is set, else data/fixtures.
// Every result says where it came from so the UI can show a SampleBadge for fixtures.
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Pool } from "pg";
import { neon } from "@/lib/db/neon";
import type { Item, ItemType, Quiz, SolveRate, VariantExperiment } from "@unprompted/shared";
import { FIXTURES_DIR, readJson, REPO_ROOT } from "@/lib/db/fixtures";

/** Neon main through C's shared client (lib/db/neon: libpq-compatible SSL, one pool for the app). */
export function neonMain(): Pool | null {
  return neon();
}

export type Source = "neon" | "fixtures";

export interface StudioData {
  quiz: Quiz | null;
  quizSource: Source;
  solveRates: SolveRate[];
  /** True when A's solve rates came from real agent runs (attack_summary.json exists). */
  solveRatesMeasured: boolean;
  attack: { itemRuns: number; itemCorrect: number; accuracy: number; ci95: [number, number]; models: string[] } | null;
  experiments: VariantExperiment[];
  experimentsSource: Source;
  recordings: string[];
}

interface ItemRow {
  id: string;
  quiz_id: string;
  stem: string;
  type: ItemType;
  choices_json: Item["choices"] | null;
  answer_key: Item["answerKey"];
  objective: string;
  objective_source?: Item["objectiveSource"] | null;
  original_item_id: string | null;
}

async function quizFromNeon(db: Pool, quizId: string): Promise<Quiz | null> {
  const q = await db.query<{ id: string; course_id: string; title: string; source_format: Quiz["sourceFormat"] }>(
    "select id, course_id, title, source_format from quiz where id = $1",
    [quizId],
  );
  const row = q.rows[0];
  if (!row) return null;
  const items = await db.query<ItemRow>("select * from item where quiz_id = $1 and original_item_id is null", [quizId]);
  items.rows.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    sourceFormat: row.source_format,
    items: items.rows.map((r) => ({
      id: r.id,
      quizId: r.quiz_id,
      stem: r.stem,
      type: r.type,
      ...(r.choices_json ? { choices: r.choices_json } : {}),
      answerKey: r.answer_key,
      objective: r.objective,
      ...(r.objective_source ? { objectiveSource: r.objective_source } : {}),
      originalItemId: null,
    })),
  };
}

async function experimentsFromNeon(db: Pool, quizId: string): Promise<VariantExperiment[]> {
  const { rows } = await db.query<{
    id: string;
    item_id: string;
    neon_branch: string;
    strategy: VariantExperiment["strategy"];
    candidate_json: VariantExperiment["candidate"];
    status: VariantExperiment["status"];
    checks_json: VariantExperiment["checks"] | null;
    reasons_json: string[] | null;
  }>(
    "select e.* from variant_experiment e join item i on i.id = e.item_id where i.quiz_id = $1 order by e.created_at, e.id",
    [quizId],
  );
  return rows.map((r) => ({
    id: r.id,
    itemId: r.item_id,
    neonBranch: r.neon_branch,
    strategy: r.strategy,
    candidate: r.candidate_json,
    status: r.status,
    checks: r.checks_json ?? {},
    reasons: r.reasons_json ?? [],
  }));
}

/** Recorded transform runs (data/fixtures/variants_events*.jsonl) that the studio can replay. */
export async function listRecordings(): Promise<string[]> {
  try {
    return (await fs.readdir(FIXTURES_DIR)).filter((f) => /^variants_events.*\.jsonl$/.test(f)).sort();
  } catch {
    return [];
  }
}

export async function getStudioData(quizId = "sample-stats"): Promise<StudioData> {
  const db = neonMain();
  let quiz: Quiz | null = null;
  let quizSource: Source = "fixtures";
  let experiments: VariantExperiment[] = [];
  let experimentsSource: Source = "fixtures";
  if (db) {
    try {
      quiz = await quizFromNeon(db, quizId);
      if (quiz) quizSource = "neon";
      experiments = await experimentsFromNeon(db, quizId);
      experimentsSource = "neon";
    } catch (e) {
      console.error("[studio] Neon read failed, using fixtures:", (e as Error).message);
    }
  }
  if (!quiz) quiz = await readJson<Quiz | null>(path.join(FIXTURES_DIR, `quiz-${quizId}.json`), null);
  if (experimentsSource === "fixtures") {
    const all = await readJson<VariantExperiment[]>(path.join(FIXTURES_DIR, "variants.json"), []);
    const ids = new Set(quiz?.items.map((i) => i.id));
    experiments = all.filter((e) => ids.has(e.itemId));
  }

  const solveRates = await readJson<SolveRate[]>(path.join(FIXTURES_DIR, "solve_rates.json"), []);
  const summary = await readJson<{
    quizId?: string;
    itemRuns: number;
    itemCorrect: number;
    accuracy: number;
    accuracyCI95: [number, number];
    byAgentModel?: Record<string, unknown>;
  } | null>(path.join(FIXTURES_DIR, "attack_summary.json"), null);
  const attack =
    summary && (!summary.quizId || summary.quizId === quizId)
      ? {
          itemRuns: summary.itemRuns,
          itemCorrect: summary.itemCorrect,
          accuracy: summary.accuracy,
          ci95: summary.accuracyCI95,
          models: Object.keys(summary.byAgentModel ?? {}),
        }
      : null;

  return {
    quiz,
    quizSource,
    solveRates: solveRates.filter((s) => quiz?.items.some((i) => i.id === s.itemId)),
    solveRatesMeasured: attack != null,
    attack,
    experiments,
    experimentsSource,
    recordings: await listRecordings(),
  };
}

export { REPO_ROOT };
