// Quiz loading and grading. Server only: answer keys never leave this module.
// The DELIVERED quiz comes from Neon main: for each original item (ordered by q<n>), the latest
// professor-approved variant replaces it in that slot, else the original is served. Fixture JSON, then
// Markdown, are the fallback only when Neon is unreachable or doesn't have the quiz.
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Item, ItemType, Quiz } from "@unprompted/shared";
import { DATA_DIR, fixturePath, readJson } from "@/lib/db/fixtures";
import { neon } from "@/lib/db/neon";

export type PublicItem = Omit<Item, "answerKey">;
export type PublicQuiz = Omit<Quiz, "items"> & { items: PublicItem[] };

const ITEM_RE = /^(\d+)\.\s*\[(mcq|multi|numeric|short)\]\s*(.+)$/;
const CHOICE_RE = /^\s*-\s*([a-z])\)\s*(.+?)\s*$/;

export function parseMarkdownQuiz(id: string, md: string): Quiz {
  const lines = md.split(/\r?\n/);
  const title = (lines.find((l) => l.startsWith("# ")) ?? `# ${id}`).slice(2);
  const items: Item[] = [];
  let cur: Item | null = null;
  for (const line of lines) {
    const m = line.match(ITEM_RE);
    if (m) {
      cur = { id: `${id}-q${m[1]}`, quizId: id, stem: m[3].trim(), type: m[2] as ItemType, answerKey: "", objective: "" };
      if (cur.type === "mcq" || cur.type === "multi") cur.choices = [];
      items.push(cur);
      continue;
    }
    if (!cur) continue;
    const c = line.match(CHOICE_RE);
    if (c && cur.choices) {
      let text = c[2];
      const isAnswer = /\(answer\)\s*$/i.test(text);
      text = text.replace(/\s*\(answer\)\s*$/i, "").trim();
      cur.choices.push({ id: c[1], text });
      if (isAnswer) {
        if (cur.type === "multi") cur.answerKey = [...(Array.isArray(cur.answerKey) ? cur.answerKey : []), c[1]];
        else cur.answerKey = c[1];
      }
      continue;
    }
    const a = line.match(/^\s*answer:\s*(.+?)\s*$/i);
    if (a) cur.answerKey = a[1];
    const o = line.match(/^\s*objective:\s*(.+?)\s*$/i);
    if (o) cur.objective = o[1];
  }
  return { id, courseId: "stats-101", title: displayTitle(title), sourceFormat: "markdown", items };
}

export function displayTitle(title: string) {
  return title.replace(/^Sample quiz:\s*/i, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

// ---------- Neon (delivered quiz) ----------
type ItemRow = {
  id: string;
  quiz_id: string;
  stem: string;
  type: ItemType;
  choices_json: { id: string; text: string }[] | null;
  answer_key: string | string[] | null;
  objective: string | null;
  original_item_id: string | null;
  figure_json: { src: string; alt: string } | null;
  figure_text: string | null;
};
const slotNo = (id: string) => Number(id.match(/-q(\d+)$/)?.[1] ?? 1e9);
const CACHE_MS = 15_000; // grading reads the quiz on every answer; approvals show up within seconds
const cache = new Map<string, { at: number; quiz: Quiz | null }>();

export async function getQuizFromNeon(id: string): Promise<Quiz | null | undefined> {
  const db = neon();
  if (!db) return undefined;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.quiz;
  try {
    const [qr, orig, vars] = await Promise.all([
      db.query<{ id: string; course_id: string | null; title: string | null; source_format: Quiz["sourceFormat"] | null }>("select id, course_id, title, source_format from quiz where id = $1", [id]),
      db.query<ItemRow>("select * from item where quiz_id = $1 and original_item_id is null", [id]),
      db.query<ItemRow & { replaces: string }>(
        `select distinct on (v.item_id) v.item_id as replaces, i.*
           from variant_experiment v join item i on i.id = v.candidate_item_id
          where v.status = 'approved' and v.item_id in (select id from item where quiz_id = $1 and original_item_id is null)
          order by v.item_id, v.created_at desc`,
        [id],
      ),
    ]);
    if (!qr.rows[0] || !orig.rows.length) {
      cache.set(id, { at: Date.now(), quiz: null });
      return null;
    }
    const replacement = new Map(vars.rows.map((r) => [r.replaces, r]));
    const toItem = (r: ItemRow): Item => ({
      id: r.id,
      quizId: id,
      stem: r.stem,
      type: r.type,
      ...(r.choices_json ? { choices: r.choices_json } : {}),
      answerKey: r.answer_key ?? "",
      objective: r.objective ?? "",
      originalItemId: r.original_item_id,
      ...(r.figure_json ? { figure: r.figure_json } : {}),
      ...(r.figure_text ? ({ figureText: r.figure_text } as object) : {}),
    });
    const items = orig.rows.sort((a, b) => slotNo(a.id) - slotNo(b.id)).map((o) => toItem(replacement.get(o.id) ?? o));
    const q = qr.rows[0];
    const quiz: Quiz = { id, courseId: q.course_id ?? "", title: displayTitle(q.title ?? id), sourceFormat: q.source_format ?? "markdown", items };
    cache.set(id, { at: Date.now(), quiz });
    return quiz;
  } catch (err) {
    console.error("[quizzes] Neon read failed, using the fixture fallback:", (err as Error).message);
    return undefined; // unreachable: fall back
  }
}

export async function getQuiz(id: string): Promise<Quiz | null> {
  if (!/^[a-z0-9-]+$/i.test(id)) return null;
  const fromNeon = await getQuizFromNeon(id);
  if (fromNeon) return fromNeon;
  const canonical = await readJson<Quiz | null>(fixturePath(`quiz-${id}.json`), null);
  if (canonical?.items?.length) return { ...canonical, title: displayTitle(canonical.title) };
  try {
    const md = await fs.readFile(path.join(DATA_DIR, "quizzes", `${id}.md`), "utf8");
    return parseMarkdownQuiz(id, md);
  } catch {
    return null;
  }
}

// Quizzes students can take: B's ingested fixtures (data/fixtures/quiz-*.json) plus raw data/quizzes/*.md.
export async function listQuizzes(): Promise<Quiz[]> {
  const [fixtures, mds] = await Promise.all([
    fs.readdir(path.join(DATA_DIR, "fixtures")).catch(() => [] as string[]),
    fs.readdir(path.join(DATA_DIR, "quizzes")).catch(() => [] as string[]),
  ]);
  const ids = new Set([
    ...fixtures.filter((f) => /^quiz-.+\.json$/.test(f)).map((f) => f.slice(5, -5)),
    ...mds.filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)),
  ]);
  const db = neon();
  if (db) {
    try {
      for (const r of (await db.query<{ id: string }>("select id from quiz")).rows) ids.add(r.id);
    } catch {
      /* Neon unreachable: files only */
    }
  }
  const quizzes = await Promise.all([...ids].sort().map((id) => getQuiz(id).catch(() => null)));
  return quizzes.filter((q): q is Quiz => q !== null && q.items.length > 0);
}

// Optional figure fields (packages/shared Item.figure; figureText stays server-side, see the accommodation rule).
export interface Figure {
  src: string;
  alt: string;
}
export type FigureItem = Quiz["items"][number] & { figure?: Figure; figureText?: string };

/** Only inline data: images or files under /figures/ are rendered. */
export function safeFigure(f: unknown): Figure | undefined {
  const x = f as Partial<Figure> | undefined;
  if (!x || typeof x.src !== "string" || typeof x.alt !== "string") return undefined;
  const ok = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(x.src) || /^\/figures\/[\w.-]+\.(png|jpe?g|gif|webp|svg)$/.test(x.src);
  return ok ? { src: x.src, alt: x.alt } : undefined;
}

export function toPublic(q: Quiz): PublicQuiz {
  return {
    ...q,
    items: q.items.map((item) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { answerKey: _k, figureText: _t, figure, ...rest } = item as FigureItem;
      const fig = safeFigure(figure);
      return { ...rest, ...(fig ? { figure: fig, hasFigureText: Boolean(_t) } : {}) };
    }),
  };
}

function parseNumber(s: string): number | null {
  const t = s.trim().replace(/\s+/g, "");
  const frac = t.match(/^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (frac) return Number(frac[2]) === 0 ? null : Number(frac[1]) / Number(frac[2]);
  const pct = t.match(/^(-?\d+(?:\.\d+)?)%$/);
  if (pct) return Number(pct[1]) / 100;
  const n = Number(t);
  return Number.isFinite(n) && t !== "" ? n : null;
}

export function grade(item: Item, answer: string | string[]): boolean {
  const key = item.answerKey;
  switch (item.type) {
    case "mcq":
      return typeof answer === "string" && answer === key;
    case "multi": {
      const a = new Set(Array.isArray(answer) ? answer : [answer]);
      const k = new Set(Array.isArray(key) ? key : [key]);
      return a.size === k.size && [...k].every((x) => a.has(x));
    }
    case "numeric": {
      const a = parseNumber(String(answer));
      const k = parseNumber(String(key));
      if (a === null || k === null) return false;
      return Math.abs(a - k) <= Math.max(1e-3, Math.abs(k) * 0.01);
    }
    case "short":
      return String(answer).trim().toLowerCase() === String(key).trim().toLowerCase();
  }
}
