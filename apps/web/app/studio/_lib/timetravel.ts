// Time-travel appeal (owner: B): "show exactly what this student saw".
// Creates a short-lived Neon branch at the attempt's snapshot LSN (C records pg_current_wal_lsn() when
// the attempt starts), reads the quiz and answer key there, compares with the quiz today, then deletes
// the branch. The student's answers come from main (they were written after the snapshot).
import "server-only";
import { Pool } from "pg";
import type { ItemType } from "@unprompted/shared";
import { neon } from "@/lib/db/neon";

const API = "https://console.neon.tech/api/v2";

interface ItemRow {
  id: string;
  stem: string;
  type: ItemType;
  choices_json: { id: string; text: string }[] | null;
  answer_key: string | string[];
  objective: string | null;
}

export interface AppealItem {
  id: string;
  stem: string;
  type: ItemType;
  choices?: { id: string; text: string }[];
  key: string | string[];
  objective?: string;
  studentAnswer?: unknown;
  correct?: boolean | null;
  /** How this question differs in the quiz today (null when unchanged). */
  changedSince: null | { stem?: string; choices?: boolean; key?: string | string[]; removed?: boolean };
}

export interface AppealData {
  attemptId: string;
  student: string; // pseudonym only
  quizId: string;
  mode: string;
  snapshotAt: string | null;
  snapshotLsn: string;
  branch: { name: string; deleted: boolean };
  items: AppealItem[];
  changedCount: number;
  timings: { branchMs: number; readMs: number; totalMs: number };
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = process.env.NEON_API_KEY?.trim();
  const project = process.env.NEON_PROJECT_ID?.trim();
  if (!key || !project) throw new Error("Time travel needs NEON_API_KEY and NEON_PROJECT_ID.");
  const r = await fetch(`${API}/projects/${project}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Neon API ${method} ${path} -> ${r.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

async function waitForOps(ops: { id: string }[] = []) {
  for (const op of ops) {
    for (let i = 0; i < 120; i++) {
      const { operation } = await api<{ operation: { status: string } }>("GET", `/operations/${op.id}`);
      if (operation.status === "finished" || operation.status === "skipped") break;
      if (["failed", "cancelled", "error"].includes(operation.status)) throw new Error(`Neon operation ${operation.status}`);
      await new Promise((res) => setTimeout(res, 400));
    }
  }
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function appealSnapshot(attemptId: string): Promise<AppealData> {
  const t0 = Date.now();
  const main = neon();
  if (!main) throw new Error("Time travel needs DATABASE_URL (Neon main).");
  const a = (
    await main.query<{ quiz_id: string; mode: string; student_pseudonym: string; lsn: string | null; quiz_snapshot_at: Date | null }>(
      "select quiz_id, mode, student_pseudonym, quiz_snapshot_lsn::text lsn, quiz_snapshot_at from attempt where id = $1",
      [attemptId],
    )
  ).rows[0];
  if (!a) throw new Error("Attempt not found.");
  if (!a.lsn) throw new Error("This attempt has no snapshot point recorded, so it can't be replayed.");

  const { branches } = await api<{ branches: { id: string; name: string; default?: boolean; primary?: boolean }[] }>("GET", "/branches");
  const parent = branches.find((b) => b.default || b.primary) ?? branches.find((b) => b.name === "main");
  if (!parent) throw new Error("Neon project has no main branch.");
  const name = `appeal/${attemptId}/${Date.now().toString(36)}`;
  const created = await api<{ branch: { id: string }; operations: { id: string }[] }>("POST", "/branches", {
    branch: { name, parent_id: parent.id, parent_lsn: a.lsn },
    endpoints: [{ type: "read_write" }],
  });
  let branchMs = 0;
  let readMs = 0;
  let pool: Pool | null = null;
  try {
    await waitForOps(created.operations);
    branchMs = Date.now() - t0;
    const u = new URL(process.env.DATABASE_URL!.trim());
    const { uri } = await api<{ uri: string }>(
      "GET",
      `/connection_uri?branch_id=${created.branch.id}&database_name=${encodeURIComponent(u.pathname.slice(1) || "neondb")}&role_name=${encodeURIComponent(decodeURIComponent(u.username))}&pooled=true`,
    );
    const conn = new URL(uri);
    conn.searchParams.set("uselibpqcompat", "true");
    pool = new Pool({ connectionString: conn.toString(), max: 1 });
    const t1 = Date.now();
    const then = await pool.query<ItemRow>("select id, stem, type, choices_json, answer_key, objective from item where quiz_id = $1 and original_item_id is null", [a.quiz_id]);
    readMs = Date.now() - t1;
    const now = await main.query<ItemRow>("select id, stem, type, choices_json, answer_key, objective from item where quiz_id = $1 and original_item_id is null", [a.quiz_id]);
    const responses = await main.query<{ item_id: string; answer: unknown; correct: boolean | null }>(
      "select item_id, answer, correct from response where attempt_id = $1",
      [attemptId],
    );
    const nowById = new Map(now.rows.map((r) => [r.id, r]));
    const respById = new Map(responses.rows.map((r) => [r.item_id, r]));
    const items: AppealItem[] = then.rows
      .sort((x, y) => x.id.localeCompare(y.id, undefined, { numeric: true }))
      .map((r) => {
        const cur = nowById.get(r.id);
        const changed: AppealItem["changedSince"] = !cur
          ? { removed: true }
          : r.stem !== cur.stem || !sameJson(r.choices_json, cur.choices_json) || !sameJson(r.answer_key, cur.answer_key)
            ? {
                ...(r.stem !== cur.stem ? { stem: cur.stem } : {}),
                ...(!sameJson(r.choices_json, cur.choices_json) ? { choices: true } : {}),
                ...(!sameJson(r.answer_key, cur.answer_key) ? { key: cur.answer_key } : {}),
              }
            : null;
        const resp = respById.get(r.id);
        return {
          id: r.id,
          stem: r.stem,
          type: r.type,
          ...(r.choices_json ? { choices: r.choices_json } : {}),
          key: r.answer_key,
          ...(r.objective ? { objective: r.objective } : {}),
          ...(resp ? { studentAnswer: resp.answer, correct: resp.correct } : {}),
          changedSince: changed,
        };
      });
    return {
      attemptId,
      student: a.student_pseudonym,
      quizId: a.quiz_id,
      mode: a.mode,
      snapshotAt: a.quiz_snapshot_at ? new Date(a.quiz_snapshot_at).toISOString() : null,
      snapshotLsn: a.lsn,
      branch: { name, deleted: false },
      items,
      changedCount: items.filter((i) => i.changedSince).length,
      timings: { branchMs, readMs, totalMs: 0 },
    };
  } finally {
    await pool?.end().catch(() => {});
    try {
      const res = await api<{ operations: { id: string }[] }>("DELETE", `/branches/${created.branch.id}`);
      await waitForOps(res.operations);
    } catch (e) {
      console.error(`[appeal] could not delete branch ${name}:`, (e as Error).message);
    }
  }
}

/** Wrapper that records deletion and total time on the result. */
export async function appeal(attemptId: string): Promise<AppealData> {
  const t0 = Date.now();
  const d = await appealSnapshot(attemptId);
  const branches = await api<{ branches: { name: string }[] }>("GET", "/branches").catch(() => ({ branches: [] }));
  return { ...d, branch: { name: d.branch.name, deleted: !branches.branches.some((b) => b.name === d.branch.name) }, timings: { ...d.timings, totalMs: Date.now() - t0 } };
}
