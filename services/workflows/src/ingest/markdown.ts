import type { Item, ItemType, Quiz } from "@unprompted/shared";
import type { Db } from "../db/types.js";

const TYPES: ItemType[] = ["mcq", "multi", "numeric", "short"];

/**
 * Parse our Markdown quiz format (see data/quizzes/sample-stats.md):
 *
 *   # Title
 *   1. [mcq] Stem text
 *      - a) choice
 *      - b) choice  (answer)
 *      objective: what it tests
 *   2. [numeric] Stem text
 *      answer: 1/6
 *      objective: ...
 *
 * `multi` items mark every correct choice with (answer).
 */
export function parseMarkdownQuiz(md: string, opts: { quizId: string; courseId: string }): Quiz {
  const lines = md.split(/\r?\n/);
  const title = (lines.find((l) => l.startsWith("# ")) ?? "# Untitled quiz").slice(2).trim();
  const items: Item[] = [];
  let cur: (Item & { _line: number }) | null = null;

  const finish = () => {
    if (!cur) return;
    const { _line, ...item } = cur;
    if (!item.objective) throw new Error(`item ${item.id} (line ${_line}) has no objective:`);
    if (item.type === "mcq" || item.type === "multi") {
      const keys = item.answerKey as string[];
      if (!item.choices?.length) throw new Error(`item ${item.id} (line ${_line}) has no choices`);
      if (keys.length === 0) throw new Error(`item ${item.id} (line ${_line}) has no (answer) choice`);
      if (item.type === "mcq" && keys.length > 1) throw new Error(`mcq item ${item.id} (line ${_line}) has several answers`);
      item.answerKey = item.type === "mcq" ? keys[0]! : keys;
    } else if (!item.answerKey) {
      throw new Error(`item ${item.id} (line ${_line}) has no answer:`);
    }
    items.push(item);
    cur = null;
  };

  lines.forEach((raw, i) => {
    const line = raw.trim();
    const head = line.match(/^(\d+)\.\s*\[(\w+)\]\s*(.+)$/);
    if (head) {
      finish();
      const type = head[2]!.toLowerCase() as ItemType;
      if (!TYPES.includes(type)) throw new Error(`line ${i + 1}: unknown item type [${head[2]}]`);
      const multiChoice = type === "mcq" || type === "multi";
      cur = {
        _line: i + 1,
        id: `${opts.quizId}-i${head[1]}`,
        quizId: opts.quizId,
        stem: head[3]!.trim(),
        type,
        ...(multiChoice ? { choices: [] } : {}),
        answerKey: multiChoice ? [] : "",
        objective: "",
        originalItemId: null,
      };
      return;
    }
    if (!cur) return;
    const choice = line.match(/^-\s*([a-z])\)\s*(.+?)(\s*\(answer\))?$/i);
    if (choice && cur.choices) {
      const id = choice[1]!.toLowerCase();
      cur.choices.push({ id, text: choice[2]!.trim() });
      if (choice[3]) (cur.answerKey as string[]).push(id);
      return;
    }
    const kv = line.match(/^(objective|answer):\s*(.+)$/i);
    if (kv) {
      if (kv[1]!.toLowerCase() === "objective") cur.objective = kv[2]!.trim();
      else cur.answerKey = kv[2]!.trim();
    }
  });
  finish();

  if (items.length === 0) throw new Error("no items found in quiz markdown");
  return { id: opts.quizId, courseId: opts.courseId, title, sourceFormat: "markdown", items };
}

/** Write a parsed quiz (course, quiz, items) to a branch. Idempotent. */
export async function saveQuiz(db: Db, quiz: Quiz, courseTitle = quiz.title): Promise<void> {
  await db.query("insert into course (id, title) values ($1, $2) on conflict (id) do nothing", [quiz.courseId, courseTitle]);
  await db.query(
    `insert into quiz (id, course_id, title, source_format) values ($1, $2, $3, $4)
     on conflict (id) do update set title = excluded.title, source_format = excluded.source_format`,
    [quiz.id, quiz.courseId, quiz.title, quiz.sourceFormat],
  );
  for (const it of quiz.items) {
    await db.query(
      `insert into item (id, quiz_id, stem, type, choices_json, answer_key, objective, original_item_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (id) do update set stem = excluded.stem, type = excluded.type, choices_json = excluded.choices_json,
         answer_key = excluded.answer_key, objective = excluded.objective`,
      [
        it.id,
        quiz.id,
        it.stem,
        it.type,
        it.choices ? JSON.stringify(it.choices) : null,
        JSON.stringify(it.answerKey),
        it.objective,
        it.originalItemId ?? null,
      ],
    );
  }
}

/** Read a quiz back from a branch as the shared Quiz type. */
export async function loadQuiz(db: Db, quizId: string): Promise<Quiz> {
  const { rows: qs } = await db.query<{ id: string; course_id: string; title: string; source_format: Quiz["sourceFormat"] }>(
    "select id, course_id, title, source_format from quiz where id = $1",
    [quizId],
  );
  const q = qs[0];
  if (!q) throw new Error(`quiz not found: ${quizId}`);
  const { rows } = await db.query<{
    id: string;
    stem: string;
    type: ItemType;
    choices_json: Item["choices"] | null;
    answer_key: Item["answerKey"];
    objective: string;
    original_item_id: string | null;
  }>("select * from item where quiz_id = $1 and original_item_id is null", [quizId]);
  rows.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return {
    id: q.id,
    courseId: q.course_id,
    title: q.title,
    sourceFormat: q.source_format,
    items: rows.map((r) => ({
      id: r.id,
      quizId,
      stem: r.stem,
      type: r.type,
      ...(r.choices_json ? { choices: r.choices_json } : {}),
      answerKey: r.answer_key,
      objective: r.objective,
      originalItemId: r.original_item_id,
    })),
  };
}
