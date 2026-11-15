// Professor insights (owner: D). Every number comes from a producer's real output (fixtures or Tiger);
// panels without data say so instead of showing placeholders.
import { Suspense } from "react";
import { connection } from "next/server";
import type { ExplainGapCell } from "@unprompted/shared";
import { AppShell } from "@/components/ui/app-shell";
import { TreeCard } from "@/app/studio/_components/tree-card";
import { loadTree } from "@/app/studio/_lib/tree";
import { Skeleton } from "@/components/ui/skeleton";
import { Kpi, Panel, PanelEmpty, SourceNote } from "@/components/dashboard/panel";
import { SolveRateHeatmap } from "@/components/dashboard/solve-rate-heatmap";
import { LeakRadar } from "@/components/dashboard/leak-radar";
import { buildLeakRadar, onlineCount } from "@/components/dashboard/leak-radar-data";
import { ExplainGapGrid, QuadrantSummary, quadrantOf } from "@/components/dashboard/explain-gap";
import { SessionTable } from "@/components/dashboard/session-table";
import { sessionSignals, whoFromPseudonym, type SessionRow } from "@/components/dashboard/session-signals";
import {
  itemLabels,
  loadAgentRuns,
  loadArchiveWatch,
  loadAttackSummary,
  loadAttempts,
  loadPseudonyms,
  loadProbeEvidence,
  loadLeaks,
  loadProbes,
  loadQuiz,
  loadSessions,
  loadSolveRates,
  loadVariants,
} from "./_data";

export default function Page() {
  return (
    <AppShell wide title="Insights" subtitle="Intro Statistics · Quiz 1. What agents can do with this quiz, what's online, and who can explain their answers.">
      <div className="space-y-6">
        <Suspense fallback={<KpiSkeleton />}>
          <KpiRow />
        </Suspense>
        <Suspense fallback={<PanelSkeleton />}>
          <AgentAttackPanel />
        </Suspense>
        <Suspense fallback={<PanelSkeleton />}>
          <LeakPanel />
        </Suspense>
        <Suspense fallback={<PanelSkeleton />}>
          <TreePanel />
        </Suspense>
        <Suspense fallback={<PanelSkeleton />}>
          <ExplainGapPanel />
        </Suspense>
        <Suspense fallback={<PanelSkeleton />}>
          <ExplanationsPanel />
        </Suspense>
        <Suspense fallback={<PanelSkeleton />}>
          <SessionsPanel />
        </Suspense>
      </div>
    </AppShell>
  );
}

function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-[88px] rounded-lg" />
      ))}
    </div>
  );
}

function PanelSkeleton() {
  return <Skeleton className="h-64 rounded-lg" />;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

async function KpiRow() {
  await connection();
  const [summary, solve, leaks, variants, probes, attempts, quiz] = await Promise.all([
    loadAttackSummary(),
    loadSolveRates(),
    loadLeaks(),
    loadVariants(),
    loadProbes(),
    loadAttempts(),
    loadQuiz(),
  ]);
  const s = summary.data;
  const items = quiz.data?.items.length ?? solve.data.length;
  // solve_rates.json covers every quiz A has attacked; count only this quiz's items.
  const quizItems = new Set(quiz.data?.items.map((i) => i.id) ?? []);
  const solveHere = quizItems.size ? solve.data.filter((r) => quizItems.has(r.itemId)) : solve.data;
  const solvable = solveHere.filter((r) => r.agentSolvable).length;
  const radar = quiz.data ? buildLeakRadar(quiz.data, leaks.data) : null;
  const leakedItems = radar ? onlineCount(radar) : 0;
  const partialItems = radar ? radar.items.filter((i) => i.hits.length && i.hits.every((h) => h.partial)).length : 0;
  const verified = variants.data.filter((v) => v.status === "verified" || v.status === "approved").length;
  const cells = buildCells(attempts.data, probes.data);
  const gaps = cells.filter((c) => c.quadrant === "explain_gap").length;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi
        label="Agent accuracy on this quiz"
        value={s ? pct(s.accuracy) : "-"}
        sub={
          s
            ? `${s.itemCorrect}/${s.itemRuns} answers · 95% CI ${pct(s.accuracyCI95[0])}-${pct(s.accuracyCI95[1])}${
                s.isolated === true ? " · sandboxed agents" : s.isolated === false ? " · pre-isolation run" : ""
              }`
            : "No agent runs yet"
        }
        tone="agent"
      />
      <Kpi label="Questions agents can solve" value={solveHere.length ? `${solvable}/${items}` : "-"} sub="Solve rate 60% or more" />
      <Kpi label="Questions found online" value={leaks.origin === "none" ? "-" : `${leakedItems}/${items}`} sub={partialItems ? `plus ${partialItems} partial match${partialItems > 1 ? "es" : ""} to check` : "Exact-phrase web search"} tone="leak" />
      <Kpi
        label="Explain gaps"
        value={cells.length ? gaps : "-"}
        sub={cells.length ? `of ${cells.length} probed answers` : variants.data.length ? `${verified} variants verified` : "No think-aloud probes yet"}
        tone="gap"
      />
    </div>
  );
}

async function AgentAttackPanel() {
  await connection();
  const [runs, quiz, summary] = await Promise.all([loadAgentRuns(), loadQuiz(), loadAttackSummary()]);
  const labels = itemLabels(quiz.data);
  const items = [...labels.entries()].map(([id, l]) => ({ id, label: l.label, stem: l.stem }));
  const infra = summary.data?.infraErrors ?? 0;
  const reasons = Object.entries(summary.data?.infraReasons ?? {})
    .map(([r, n]) => `${n} ${r}`)
    .join(", ");
  return (
    <Panel
      title="What agents can do"
      description="The same browser agents students can use, run against a sandbox copy of this quiz."
      meta={<SourceNote origin={runs.origin} updatedAt={runs.updatedAt} />}
    >
      {runs.data.length && items.length ? (
        <>
          <SolveRateHeatmap items={items} runs={runs.data} />
          {infra > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {infra} runs never reached the quiz and are excluded from every number here{reasons ? ` (${reasons})` : ""}.
            </p>
          )}
        </>
      ) : (
        <PanelEmpty>No agent runs yet. Start an attack from Studio.</PanelEmpty>
      )}
    </Panel>
  );
}

async function LeakPanel() {
  await connection();
  const [leaks, quiz, archive] = await Promise.all([loadLeaks(), loadQuiz(), loadArchiveWatch()]);
  if (leaks.origin === "none" || !quiz.data) {
    return (
      <Panel title="Found online" description="Search results whose text matches a question.">
        <PanelEmpty>No leak scan has run for this quiz yet.</PanelEmpty>
      </Panel>
    );
  }
  const radar = buildLeakRadar(quiz.data, leaks.data, { archive: archive.data ?? undefined });
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <h2 className="text-[15px] font-semibold">Found online</h2>
        <SourceNote origin={leaks.origin} updatedAt={leaks.updatedAt} />
      </div>
      <LeakRadar data={radar} />
    </div>
  );
}

async function TreePanel() {
  await connection();
  const quiz = await loadQuiz();
  const quizId = quiz.data?.id ?? "sample-stats";
  let tree: Awaited<ReturnType<typeof loadTree>> | null = null;
  let error: string | null = null;
  try {
    tree = await loadTree(quizId);
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <div className="space-y-2">
      <div className="px-1">
        <h2 className="text-[15px] font-semibold">Experiment tree</h2>
      </div>
      {tree ? <TreeCard data={tree} /> : <PanelEmpty>{error ? `Couldn't read the experiment tree: ${error}` : "No experiments yet."}</PanelEmpty>}
    </div>
  );
}

async function ExplanationsPanel() {
  await connection();
  const [ev, quiz] = await Promise.all([loadProbeEvidence(), loadQuiz()]);
  const labels = itemLabels(quiz.data);
  return (
    <Panel
      title="Think-aloud explanations"
      description="How each explanation was given. Typed explanations can be AI-written; pair them with voice or a follow-up chat. Accommodations are never checked."
      meta={<SourceNote origin={ev.origin} updatedAt={ev.updatedAt} />}
    >
      {ev.data.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Student</th>
                <th className="py-1.5 pr-3 font-medium">Question</th>
                <th className="py-1.5 pr-3 font-medium">Mode</th>
                <th className="py-1.5 pr-3 text-right font-medium">Score</th>
                <th className="py-1.5 font-medium">Typing evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ev.data.map((r) => (
                <tr key={r.probeId}>
                  <td className="num py-2 pr-3 text-xs">{r.student}</td>
                  <td className="num py-2 pr-3 text-xs">{labels.get(r.itemId)?.label ?? r.itemId}</td>
                  <td className="py-2 pr-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.mode === "voice" ? "bg-understood-soft text-understood" : r.mode === "typed" ? "bg-muted text-foreground" : "bg-muted text-muted-foreground"}`}>
                      {r.mode === "accommodation" ? "Accommodation" : r.mode === "voice" ? "Voice" : "Typed"}
                    </span>
                  </td>
                  <td className="num py-2 pr-3 text-right">{r.score == null ? <span className="text-xs text-muted-foreground">not graded</span> : `${r.score}/4`}</td>
                  <td className="py-2 text-xs">
                    {r.mode !== "typed" ? (
                      <span className="text-muted-foreground">{r.mode === "voice" ? "Spoken" : "Excluded (accommodation)"}</span>
                    ) : r.evidence === "no text" ? (
                      <span className="text-muted-foreground">No text</span>
                    ) : r.notes.length ? (
                      <>
                        <span className="text-gap">{r.notes.join(" · ")}</span>
                        <span className="mt-0.5 block text-muted-foreground">Suggest a voice follow-up.</span>
                      </>
                    ) : (
                      <span>
                        Typed by hand{" "}
                        <span className="num text-muted-foreground">
                          {r.keys} keys for {r.chars} characters{r.medianKeyMs != null ? `, ${r.medianKeyMs} ms between keys` : ""}
                        </span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <PanelEmpty>No think-aloud explanations yet.</PanelEmpty>
      )}
    </Panel>
  );
}

type Attempt = Awaited<ReturnType<typeof loadAttempts>>["data"][number];
type ProbeT = Awaited<ReturnType<typeof loadProbes>>["data"][number];

function buildCells(attempts: Attempt[], probes: ProbeT[]): ExplainGapCell[] {
  const byAttempt = new Map(attempts.map((a) => [a.id, a]));
  const cells: ExplainGapCell[] = [];
  for (const p of probes) {
    const a = byAttempt.get(p.attemptId);
    if (!a || a.studentPseudonym.startsWith("agent-")) continue;
    const r = a.responses?.find((x) => x.itemId === p.itemId);
    const understanding = p.finalScore ?? null;
    const q = r ? quadrantOf(r.correct, understanding) : null;
    if (q && r) cells.push({ studentPseudonym: a.studentPseudonym, itemId: p.itemId, correct: r.correct, understanding, quadrant: q });
  }
  return cells;
}

async function ExplainGapPanel() {
  await connection();
  const [attempts, probes, quiz] = await Promise.all([loadAttempts(), loadProbes(), loadQuiz()]);
  const labels = itemLabels(quiz.data);
  const cells = buildCells(attempts.data, probes.data);
  const people = attempts.data.filter((a) => !a.studentPseudonym.startsWith("agent-"));
  const students = [...new Set(people.map((a) => a.studentPseudonym))];
  const correctness = new Map<string, boolean>();
  for (const a of people) for (const r of a.responses ?? []) correctness.set(`${a.studentPseudonym}|${r.itemId}`, r.correct);
  const items = [...labels.entries()].map(([id, l]) => ({ id, label: l.label }));
  return (
    <Panel
      title="Who can explain their answers"
      description="Right answers are compared with the student's own explanation in the think-aloud. Scores are suggestions for you to review."
      meta={<SourceNote origin={probes.origin === "none" ? attempts.origin : probes.origin} updatedAt={probes.updatedAt ?? attempts.updatedAt} />}
    >
      {cells.length ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
          <QuadrantSummary cells={cells} />
          <ExplainGapGrid students={students} items={items} cells={cells} correctness={correctness} />
        </div>
      ) : (
        <PanelEmpty>
          {students.length
            ? `${students.length} student attempt${students.length > 1 ? "s" : ""}, but no graded think-aloud probes yet.`
            : "No student attempts yet."}
        </PanelEmpty>
      )}
    </Panel>
  );
}

async function SessionsPanel() {
  await connection();
  const sessions = await loadSessions();
  const pseudo = await loadPseudonyms(sessions.data.map((x) => x.attempt_id));
  const rows: SessionRow[] = sessions.data.map((s) => {
    const base = {
      attemptId: s.attempt_id,
      who: whoFromPseudonym(pseudo.get(s.attempt_id)),
      answers: s.answers,
      keys: s.keys,
      clicks: s.clicks,
      clickNoMoveRatio: s.click_no_move_ratio,
      answerNoInputRatio: s.answer_no_input_ratio,
      answersInDeadRange: s.answers_in_dead_range,
      keyCv: s.key_dt_cv,
      secondsAway: s.ms_away / 1000,
      webdriver: s.webdriver,
    };
    return { ...base, signals: sessionSignals(base) };
  });
  return (
    <Panel
      title="Session patterns"
      description="Evidence, not a classifier: behaviour signals per session, next to real agent runs and scripted tests. The only human reference is the instructor's own practice sessions, so n is too small for accuracy claims."
      meta={<SourceNote origin={sessions.origin} updatedAt={sessions.updatedAt} />}
    >
      {rows.length ? <SessionTable rows={rows} /> : <PanelEmpty>No sessions recorded yet. They appear here as students take the quiz.</PanelEmpty>}
    </Panel>
  );
}
