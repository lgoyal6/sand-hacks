// Student progress: calibration per topic, what to review, and a modest streak.
// Built from the student's own attempts and think-alouds (Neon first, JSON fallback).
// Mastery framing only: this is for the learner, never about integrity.
import "server-only";
import type { Quiz } from "@unprompted/shared";
import { listAttempts, type AttemptRecord } from "../quiz/_lib/attempts";
import { getQuiz, displayTitle, listQuizzes } from "../quiz/_lib/quizzes";
import type { RoadmapItem } from "@/components/ui/roadmap";
import { listProbes, type ProbeRecord } from "./probes";

export interface TopicCalibration {
  quizId: string;
  title: string;
  probes: number; // completed think-alouds in this topic
  /** All three on 0..1 so they share one axis. Confidence 1..7 maps to 0..1. */
  before: number | null;
  after: number | null;
  /** Explanation score (0..4 -> 0..1) when graded; otherwise share of think-aloud answers that were right. */
  outcome: number | null;
  outcomeKind: "explanation" | "answers";
}

export interface ReviewSkill {
  quizId: string;
  topic: string;
  skill: string;
  itemIds: string[];
  reason: "unexplained" | "missed";
}

export interface Progress {
  student: string | null;
  sample: boolean;
  topics: TopicCalibration[];
  review: ReviewSkill[];
  explainedThisWeek: number;
  streakDays: number;
  takeaway: string;
  roadmap?: RoadmapItem[];
  roadmapSummary?: { done: number; total: number; toReview: number };
}

const scaleConf = (c: number) => (c - 1) / 6;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const dayKey = (iso: string) => iso.slice(0, 10);

function takeawayFor(topics: TopicCalibration[]): string {
  const t = topics.filter((x) => x.before !== null && x.after !== null);
  if (!t.length) return "Do a think-aloud in any practice quiz, and your calibration shows up here.";
  const drop = mean(t.map((x) => x.before! - x.after!))!;
  if (drop > 0.08) return "Your confidence usually dips once you explain. That's normal, and it points straight at what to review.";
  if (drop < -0.08) return "Explaining tends to make you more sure, not less. Your reasoning is holding up when you say it out loud.";
  return "Your confidence stays steady when you explain. Keep checking it against how the answers actually go.";
}

export function buildProgress(student: string | null, attempts: AttemptRecord[], probes: ProbeRecord[], quizzes: Map<string, Quiz>): Progress {
  const byQuiz = new Map<string, { probes: ProbeRecord[]; attempts: AttemptRecord[] }>();
  for (const a of attempts) {
    const g = byQuiz.get(a.quizId) ?? { probes: [], attempts: [] };
    g.attempts.push(a);
    byQuiz.set(a.quizId, g);
  }
  const completed = probes.filter((p) => p.completedAt && p.confidenceAfter !== undefined);
  for (const p of completed) byQuiz.get(p.quizId)?.probes.push(p);

  const correctOf = (attemptId: string, itemId: string) =>
    attempts.find((a) => a.id === attemptId)?.responses.find((r) => r.itemId === itemId)?.correct ?? null;

  const topics: TopicCalibration[] = [];
  for (const [quizId, g] of byQuiz) {
    const quiz = quizzes.get(quizId);
    if (!quiz || !g.probes.length) continue;
    const scored = g.probes.filter((p) => typeof p.finalScore === "number");
    const outcomes = scored.length
      ? scored.map((p) => p.finalScore! / 4)
      : g.probes.map((p) => correctOf(p.attemptId, p.itemId)).filter((c): c is boolean => c !== null).map((c) => (c ? 1 : 0));
    topics.push({
      quizId,
      title: displayTitle(quiz.title),
      probes: g.probes.length,
      before: mean(g.probes.map((p) => scaleConf(p.confidenceBefore))),
      after: mean(g.probes.filter((p) => p.confidenceAfter !== undefined).map((p) => scaleConf(p.confidenceAfter!))),
      outcome: mean(outcomes),
      outcomeKind: scored.length ? "explanation" : "answers",
    });
  }

  // What to review: skills answered right but not explained well (or confidence fell hard), then missed skills.
  const review = new Map<string, ReviewSkill>();
  const add = (quizId: string, itemId: string, reason: ReviewSkill["reason"]) => {
    const quiz = quizzes.get(quizId);
    const item = quiz?.items.find((i) => i.id === itemId);
    if (!quiz || !item) return;
    const key = `${quizId}|${item.objective || item.id}`;
    const cur = review.get(key);
    if (cur) {
      if (!cur.itemIds.includes(itemId)) cur.itemIds.push(itemId);
      if (reason === "unexplained") cur.reason = "unexplained";
      return;
    }
    review.set(key, { quizId, topic: displayTitle(quiz.title), skill: item.objective || item.stem, itemIds: [itemId], reason });
  };
  for (const p of completed) {
    const right = correctOf(p.attemptId, p.itemId);
    const thin = typeof p.finalScore === "number" ? p.finalScore <= 1 : p.confidenceBefore - (p.confidenceAfter ?? p.confidenceBefore) >= 2;
    if (right && thin) add(p.quizId, p.itemId, "unexplained");
  }
  for (const a of attempts) for (const r of a.responses) if (!r.correct) add(a.quizId, r.itemId, "missed");
  const reviewList = [...review.values()].sort((x, y) => (x.reason === y.reason ? 0 : x.reason === "unexplained" ? -1 : 1)).slice(0, 6);

  // Streak: consecutive days, ending today or yesterday, with at least one finished think-aloud.
  const days = new Set(completed.map((p) => dayKey(p.completedAt!)));
  let streak = 0;
  const d = new Date();
  if (!days.has(dayKey(d.toISOString()))) d.setUTCDate(d.getUTCDate() - 1);
  while (days.has(dayKey(d.toISOString()))) {
    streak++;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;

  return {
    student,
    sample: false,
    topics: topics.sort((a, b) => b.probes - a.probes),
    review: reviewList,
    explainedThisWeek: completed.filter((p) => Date.parse(p.completedAt!) >= weekAgo).length,
    streakDays: streak,
    takeaway: takeawayFor(topics),
  };
}

export async function progressFor(opts: { student?: string; attemptIds?: string[] }): Promise<Progress> {
  let attempts: AttemptRecord[] = [];
  if (opts.student) attempts = await listAttempts({ student: opts.student });
  else if (opts.attemptIds?.length) {
    const all = await listAttempts();
    const ids = new Set(opts.attemptIds);
    attempts = all.filter((a) => ids.has(a.id));
  }
  const probes = (await Promise.all(attempts.map((a) => listProbes({ attemptId: a.id })))).flat();
  const quizIds = [...new Set(attempts.map((a) => a.quizId))];
  const quizzes = new Map((await Promise.all(quizIds.map((id) => getQuiz(id)))).filter((q): q is Quiz => !!q).map((q) => [q.id, q]));
  const progress = buildProgress(opts.student ?? null, attempts, probes, quizzes);
  const published = await listQuizzes();
  const rm = buildRoadmap(attempts, probes, published, progress.review);
  return { ...progress, roadmap: rm.items, roadmapSummary: rm.summary };
}

// Clearly labelled sample for an empty profile, so the page explains itself.
export function sampleProgress(): Progress {
  const topics: TopicCalibration[] = [
    { quizId: "sample-stats", title: "Intro Statistics", probes: 4, before: 0.78, after: 0.55, outcome: 0.5, outcomeKind: "answers" },
    { quizId: "calc-derivatives", title: "Calculus I: Derivatives", probes: 3, before: 0.67, after: 0.61, outcome: 0.67, outcomeKind: "answers" },
    { quizId: "python-basics", title: "Intro Programming: Python Basics", probes: 2, before: 0.5, after: 0.58, outcome: 1, outcomeKind: "answers" },
  ];
  return {
    student: null,
    sample: true,
    topics,
    review: [
      { quizId: "sample-stats", topic: "Intro Statistics", skill: "relationship between n and CI width", itemIds: ["sample-stats-q2"], reason: "unexplained" },
      { quizId: "calc-derivatives", topic: "Calculus I: Derivatives", skill: "apply the chain rule to a composite function", itemIds: ["calc-derivatives-q2"], reason: "missed" },
    ],
    explainedThisWeek: 5,
    streakDays: 2,
    takeaway: takeawayFor(topics),
    roadmapSummary: { done: 2, total: 4, toReview: 2 },
    roadmap: [
      { id: "s1", title: "Intro Statistics", description: "Score 4/5, explained 3 of 4.", category: "Intro Statistics", status: "Done", count: 1, action: { label: "Review", href: "/quiz/sample-stats?mode=practice" }, progress: 80, progressLabel: "4/5", agents: ["tutor", "explain-coach"] },
      { id: "s2", title: "Calculus I: Derivatives", description: "Score 5/6, needs a think-aloud.", category: "Calculus I", status: "Done", count: 0, action: { label: "Review", href: "/quiz/calc-derivatives?mode=practice" }, progress: 83, progressLabel: "5/6", agents: ["tutor"] },
      { id: "s3", title: "Relationship between n and CI width", description: "You got it right; explaining it was harder. A short practice with a think-aloud.", category: "Intro Statistics", status: "In progress", count: 1, action: { label: "Practice", href: "/quiz/sample-stats?mode=practice&focus=sample-stats-q2" }, agents: ["tutor", "explain-coach"] },
      { id: "s4", title: "Biology: Cells and Energy", description: "6 questions, with a short think-aloud.", category: "Biology", status: "Up next", count: 0, action: { label: "Continue", href: "/quiz/bio-cells?mode=graded" } },
    ],
  };
}

const classOf = (title: string) => (title.includes(":") ? title.split(":")[0].trim() : title);

/** Roadmap rows: one per published quiz (in order), then one per skill to review. */
export function buildRoadmap(attempts: AttemptRecord[], probes: ProbeRecord[], quizzes: Quiz[], review: ReviewSkill[]) {
  const items: RoadmapItem[] = [];
  let done = 0;
  for (const q of quizzes) {
    const title = displayTitle(q.title);
    // Attempts that were opened but never answered don't count as started.
    const mine = attempts.filter((a) => a.quizId === q.id && a.responses.length > 0);
    const finished = mine.filter((a) => a.finishedAt);
    const best = finished.reduce<{ score: number; total: number } | null>((b, a) => {
      const score = a.responses.filter((r) => r.correct).length;
      return !b || score > b.score ? { score, total: q.items.length } : b;
    }, null);
    const qp = probes.filter((p) => p.quizId === q.id && p.completedAt);
    const graded = qp.filter((p) => typeof p.finalScore === "number");
    const explained = graded.filter((p) => (p.finalScore ?? 0) >= 2).length;
    const open = review.filter((r) => r.quizId === q.id).length;
    const status: RoadmapItem["status"] = best ? "Done" : mine.length ? "In progress" : "Up next";
    if (best) done++;
    const parts: string[] = [];
    if (best) parts.push(`Score ${best.score}/${best.total}`);
    if (qp.length) parts.push(graded.length ? `explained ${explained} of ${graded.length}` : `${qp.length} think-aloud${qp.length === 1 ? "" : "s"} waiting for feedback`);
    else if (best) parts.push("needs a think-aloud");
    const latest = [...mine].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    if (!best && latest) parts.unshift(`${Math.min(latest.responses.length, q.items.length)} of ${q.items.length} answered in your latest try`);
    if (!best && !mine.length) parts.push(`${q.items.length} questions, with a short think-aloud`);
    items.push({
      id: `quiz-${q.id}`,
      title,
      description: parts.join(", ").replace(/^./, (c) => c.toUpperCase()) + ".",
      category: classOf(title),
      status,
      count: open,
      action: { label: best ? "Review" : "Continue", href: `/quiz/${q.id}?mode=${best ? "practice" : "graded"}` },
      ...(best ? { progress: (best.score / Math.max(1, best.total)) * 100, progressLabel: `${best.score}/${best.total}`, agents: qp.length ? ["tutor", "explain-coach"] : ["tutor"] } : {}),
    });
  }
  for (const r of review) {
    items.push({
      id: `skill-${r.quizId}-${r.itemIds.join("-")}`,
      title: r.skill.charAt(0).toUpperCase() + r.skill.slice(1),
      description: r.reason === "unexplained" ? "You got it right; explaining it was harder. A short practice with a think-aloud." : "Worth another try in practice.",
      category: classOf(r.topic),
      status: "In progress",
      count: r.itemIds.length,
      action: { label: "Practice", href: `/quiz/${r.quizId}?mode=practice&focus=${r.itemIds.join(",")}` },
      agents: ["tutor", "explain-coach"],
    });
  }
  return { items, summary: { done, total: quizzes.length, toReview: review.length } };
}
