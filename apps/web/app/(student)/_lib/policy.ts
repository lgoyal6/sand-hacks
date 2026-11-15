// Probe policy (build plan 4.3).
//   priority(item) = 0.5*solve_rate + 0.2*leaked + 0.2*session_anomaly + 0.1*random
// At most 2 probes per graded quiz, at least 1 in practice. The plan is drawn when the attempt starts
// (solve rate, leaks, randomness) and kept server-side, so the timing can't be predicted from the page.
// Session anomaly is only known after the student answers, so it is checked at submit time and can
// pull a probe forward onto the current item while the cap still allows it.
import "server-only";
import type { LeakFinding, SolveRate } from "@unprompted/shared";
import { fixturePath, readJson } from "@/lib/db/fixtures";
import { itemSignals } from "./signals";

export const MAX_PROBES = { graded: 2, practice: 2 } as const;
export const MIN_PROBES = { graded: 1, practice: 1 } as const;

export interface PlannedItem {
  itemId: string;
  solveRate: number;
  leaked: boolean;
  random: number;
  priority: number;
}

export async function planProbes(itemIds: string[], mode: "practice" | "graded"): Promise<{ plan: string[]; scored: PlannedItem[] }> {
  const [rates, leaks] = await Promise.all([
    readJson<SolveRate[]>(fixturePath("solve_rates.json"), []),
    readJson<LeakFinding[]>(fixturePath("leaks.json"), []),
  ]);
  const rateBy = new Map(rates.map((r) => [r.itemId, r.solveRate]));
  const leaked = new Set(leaks.filter((l) => (l.matchScore ?? 0) >= 0.5).map((l) => l.itemId));
  const scored = itemIds.map((itemId) => {
    // Unknown solve rate: assume the agent-solvable prior from our sandbox runs (0.6) rather than 0.
    const solveRate = rateBy.get(itemId) ?? 0.6;
    const random = Math.random();
    const priority = 0.5 * solveRate + 0.2 * (leaked.has(itemId) ? 1 : 0) + 0.1 * random;
    return { itemId, solveRate, leaked: leaked.has(itemId), random, priority };
  });
  const k = Math.min(itemIds.length, mode === "graded" ? MIN_PROBES.graded + (Math.random() < 0.5 ? 1 : 0) : MIN_PROBES.practice);
  const plan = [...scored].sort((a, b) => b.priority - a.priority).slice(0, Math.max(k, 0)).map((s) => s.itemId);
  return { plan, scored };
}

// Decide at submit time. Returns true when this item should get a probe now.
export async function shouldProbe(args: {
  attemptId: string;
  itemId: string;
  mode: "practice" | "graded";
  plan: string[];
  triggered: string[];
  remainingItems: number; // items after this one
}): Promise<{ probe: boolean; anomaly: number; reason: string }> {
  const { attemptId, itemId, mode, plan, triggered, remainingItems } = args;
  const cap = MAX_PROBES[mode];
  if (triggered.includes(itemId)) return { probe: false, anomaly: 0, reason: "already probed" };
  // Accommodation rule (CONTRACTS): an item answered with its accessible version always gets the
  // think-aloud, even past the cap. It is never penalized; the explanation is the evidence.
  if (plan.includes(`acc:${itemId}`)) return { probe: true, anomaly: 0, reason: "accommodation" };
  if (triggered.length >= cap) return { probe: false, anomaly: 0, reason: "cap reached" };
  const signals = await itemSignals(attemptId, itemId);
  const anomaly = signals.anomaly;
  if (plan.includes(itemId)) return { probe: true, anomaly, reason: "planned" };
  // 0.2 * anomaly is the anomaly term of the priority formula; a strong signal alone can pull a probe forward.
  if (0.2 * anomaly >= 0.15) return { probe: true, anomaly, reason: "session anomaly" };
  // Guarantee the minimum before the quiz ends (planned items may have been skipped).
  const min = MIN_PROBES[mode];
  const plannedLeft = plan.filter((p) => !p.startsWith("acc:") && !triggered.includes(p) && p !== itemId).length;
  if (remainingItems === 0 && triggered.length < min && plannedLeft === 0) return { probe: true, anomaly, reason: "minimum" };
  return { probe: false, anomaly, reason: "not selected" };
}
