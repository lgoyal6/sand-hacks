// Quiz loading and grading. Server only: answer keys never leave this module.
// Sources, in order: B's canonical ingest output data/fixtures/quiz-<id>.json (ids like stats-q1-i1),
// then a raw data/quizzes/<id>.md. Later: Neon `item` rows (owner B).
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Item, ItemType, Quiz } from "@unprompted/shared";
import { DATA_DIR, fixturePath, readJson } from "@/lib/db/fixtures";

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

export async function getQuiz(id: string): Promise<Quiz | null> {
  if (!/^[a-z0-9-]+$/i.test(id)) return null;
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
  const quizzes = await Promise.all([...ids].sort().map((id) => getQuiz(id).catch(() => null)));
  return quizzes.filter((q): q is Quiz => q !== null && q.items.length > 0);
}

export function toPublic(q: Quiz): PublicQuiz {
  return { ...q, // eslint-disable-next-line @typescript-eslint/no-unused-vars
    items: q.items.map(({ answerKey: _k, ...rest }) => rest) };
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
