// Leak scout: finds a quiz's questions published online, using D's leak scan (Bright Data SERP).
// Professor-facing (the /api/agents route enforces the role). Returns evidence, never accusations;
// D's LeakRadar card renders the findings (buildLeakRadar in apps/web).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { BrightDataSerp, brightDataFromEnv, scanAll } from "@unprompted/leakscan";
import type { LeakFinding } from "@unprompted/shared";
import { z } from "zod";
import { FIXTURES_DIR } from "../paths.js";
import { AnswerBeforeLimit, FlattenToolHistory } from "./compat.js";
import { getQuiz, store } from "./data.js";
import { agentModels } from "./model.js";

/** Findings on record: Neon leak_finding rows for the quiz's items, else D's data/fixtures/leaks.json. */
async function findingsOnRecord(itemIds: string[]): Promise<{ findings: LeakFinding[]; source: "neon" | "fixture" | "none" }> {
  try {
    const db = (await (await store()).main()).db;
    const { rows } = await db.query<{
      id: string;
      item_id: string;
      query: string;
      url: string;
      source_type: LeakFinding["sourceType"];
      snippet: string;
      screenshot_url: string | null;
      found_at: Date | string;
      match_score: number;
    }>("select * from leak_finding where item_id = any($1)", [itemIds]);
    if (rows.length) {
      return {
        source: "neon",
        findings: rows.map((r) => ({
          id: r.id,
          itemId: r.item_id,
          query: r.query,
          url: r.url,
          sourceType: r.source_type,
          snippet: r.snippet,
          ...(r.screenshot_url ? { screenshotUrl: r.screenshot_url } : {}),
          foundAt: new Date(r.found_at).toISOString(),
          matchScore: Number(r.match_score),
        })),
      };
    }
  } catch {
    /* fall through to the fixture */
  }
  const all = await readFile(path.join(FIXTURES_DIR, "leaks.json"), "utf8").then((t) => JSON.parse(t) as LeakFinding[], () => []);
  const findings = all.filter((f) => itemIds.includes(f.itemId));
  return { findings, source: findings.length ? "fixture" : "none" };
}

export const leakReport = createTool({
  id: "leakReport",
  description: "Leak findings already on record for a quiz: which questions were found online, where, and the evidence snippet.",
  inputSchema: z.object({ quizId: z.string() }),
  outputSchema: z.object({ quizId: z.string(), quizTitle: z.string(), itemsTotal: z.number(), findings: z.array(z.any()), source: z.string() }),
  execute: async ({ quizId }) => {
    const quiz = await getQuiz(quizId);
    const { findings, source } = await findingsOnRecord(quiz.items.map((i) => i.id));
    return { quizId, quizTitle: quiz.title, itemsTotal: quiz.items.length, findings, source };
  },
});

export const scanQuizForLeaks = createTool({
  id: "scanQuizForLeaks",
  description: "Search the web now (Bright Data SERP) for a quiz's questions: exact-phrase windows, then a fuzzy pass on study sites. Slow (seconds per question). Returns new findings; nothing is saved.",
  inputSchema: z.object({ quizId: z.string(), itemIds: z.array(z.string()).optional() }),
  outputSchema: z.object({ quizId: z.string(), scanned: z.number(), queries: z.number(), queryErrors: z.number(), findings: z.array(z.any()) }),
  execute: async ({ quizId, itemIds }) => {
    const cfg = brightDataFromEnv();
    if (!cfg) throw new Error("Bright Data isn't configured (BRIGHTDATA_API_TOKEN, BRIGHTDATA_SERP_ZONE).");
    const quiz = await getQuiz(quizId);
    const items = quiz.items.filter((i) => !itemIds?.length || itemIds.includes(i.id)).slice(0, 6);
    const scans = await scanAll(
      items.map((i) => ({ id: i.id, stem: i.stem })),
      new BrightDataSerp(cfg),
      { threshold: 0.5, concurrency: 2 },
    );
    return {
      quizId,
      scanned: items.length,
      queries: scans.reduce((n, s) => n + s.queries.length, 0),
      queryErrors: scans.reduce((n, s) => n + s.queries.filter((q) => q.error).length, 0),
      findings: scans.flatMap((s) => s.findings),
    };
  },
});

export const leakScout = new Agent({
  id: "leak-scout",
  name: "Leak scout",
  description: "Checks whether a quiz's questions are already published online and summarizes the evidence for the professor.",
  instructions: `You are the Leak scout in Unprompted, talking with a professor about one of their quizzes.
- Start with leakReport. Run scanQuizForLeaks only when the professor asks for a fresh scan or nothing is on record.
- Summarize in 2-4 sentences: how many questions appear online, where (site names), and how strong the match is. Say plainly when a match only shares a phrase and may be a false positive.
- Findings are evidence about the questions, never about students. Never suggest anyone cheated.
- The app renders the full leak radar card from your tool results, so don't list every URL.
- No em dashes. Formatting: plain text plus **bold** only.`,
  model: (() => agentModels()) as never,
  inputProcessors: [new FlattenToolHistory(), new AnswerBeforeLimit(4)],
  tools: { leakReport, scanQuizForLeaks },
});
