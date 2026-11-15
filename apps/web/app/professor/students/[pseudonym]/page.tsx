// One student (owner: D): every question exactly as it was served, their answer, their think-aloud, and
// the professor's approval. Evidence for a conversation, never a verdict. Accommodations are never checked.
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, Check, Mic, Keyboard, Accessibility, X } from "lucide-react";
import { AppShell } from "@/components/ui/app-shell";
import { Kpi, Panel } from "@/components/dashboard/panel";
import { loadStudent, type AttemptDetail } from "../_lib";
import { CalibrationText } from "../roster-table";
import { ApproveButton } from "./approve-button";
import { LoadingShell } from "@/components/ui/page-loader";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

export default function Page({ params }: PageProps<"/professor/students/[pseudonym]">) {
  return (
    <Suspense fallback={<LoadingShell title="Loading this student" subtitle="Gathering each question as they saw it" />}>
      <Student params={params} />
    </Suspense>
  );
}

async function Student({ params }: { params: Promise<{ pseudonym: string }> }) {
  await connection();
  const { pseudonym: raw } = await params;
  const pseudonym = decodeURIComponent(raw);
  if (!/^[\w-]{1,64}$/.test(pseudonym)) notFound();
  const data = await loadStudent(pseudonym);
  if (!data) notFound();
  const { row, attempts } = data;
  return (
    <AppShell wide title={pseudonym} subtitle={row.who === "human" ? "Student" : `Not a student: ${row.who}`}>
      <div className="space-y-6">
        <Link href="/professor/students" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> All students
        </Link>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Latest quiz" value={row.latest ? `${row.latest.score}/${row.latest.total}` : "none"} sub={row.latest ? `${row.latest.mode}, ${when(row.latest.at)}` : undefined} />
          <Kpi label="Think-alouds" value={row.thinkAlouds} sub={row.thinkAloudAvg != null ? `average ${row.thinkAloudAvg}/4` : "none scored yet"} />
          <Kpi label="Confidence vs results" value={row.calibration ? `${row.calibration.gap > 0 ? "+" : ""}${row.calibration.gap}` : "n/a"} sub={<CalibrationText c={row.calibration} />} />
          <Kpi label="Scores to approve" value={row.awaitingApproval} />
        </div>
        {row.followUp && (
          <div className="rounded-lg border border-gap/30 bg-gap-soft px-4 py-3 text-sm">
            <span className="font-medium">Suggested follow-up: </span>
            {row.followUp}
            <span className="mt-0.5 block text-xs text-muted-foreground">A suggestion for a conversation. It does not change a grade.</span>
          </div>
        )}
        {attempts.map((a) => (
          <AttemptPanel key={a.attemptId} a={a} />
        ))}
      </div>
    </AppShell>
  );
}

function answerText(answer: unknown, choices: { id: string; text: string }[]) {
  if (answer == null) return null;
  const ids = Array.isArray(answer) ? answer : [answer];
  return ids.map((v) => choices.find((c) => c.id === v)?.text ?? String(v)).join(", ");
}

function AttemptPanel({ a }: { a: AttemptDetail }) {
  return (
    <Panel
      title={`${a.mode === "graded" ? "Graded" : "Practice"} quiz, ${when(a.startedAt)}`}
      description={`${a.score}/${a.total} correct${a.finishedAt ? "" : ", not finished"}${a.accommodations ? `, ${a.accommodations} accommodation${a.accommodations > 1 ? "s" : ""}` : ""}. Questions are shown exactly as this student saw them.`}
    >
      <ol className="divide-y divide-border">
        {a.items.map((it) => {
          const ans = answerText(it.answer, it.choices);
          return (
            <li key={it.id} className="grid gap-4 py-4 lg:grid-cols-2">
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="num font-medium text-foreground">{it.label}</span>
                  {it.isVariant && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">variant</span>}
                  {it.seconds != null && <span className="num">{Math.round(it.seconds)} s</span>}
                </p>
                <p className="text-sm whitespace-pre-wrap">{it.stem}</p>
                {it.figureAlt && <p className="text-xs text-muted-foreground">Figure: {it.figureAlt}</p>}
                {it.choices.length > 0 && (
                  <ul className="space-y-1">
                    {it.choices.map((c) => {
                      const picked = Array.isArray(it.answer) ? it.answer.includes(c.id) : it.answer === c.id;
                      return (
                        <li key={c.id} className={`rounded-md border px-2.5 py-1.5 text-sm ${picked ? (it.correct ? "border-understood/40 bg-understood-soft" : "border-gap/40 bg-gap-soft") : "border-border"}`}>
                          {c.text}
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="flex items-center gap-1.5 text-xs">
                  {it.correct == null ? (
                    <span className="text-muted-foreground">Not answered</span>
                  ) : it.correct ? (
                    <span className="inline-flex items-center gap-1 text-understood"><Check className="size-3.5" /> Correct</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-gap"><X className="size-3.5" /> Incorrect</span>
                  )}
                  {it.choices.length === 0 && ans && <span className="text-muted-foreground">, answered: {ans}</span>}
                </p>
              </div>
              <div>{it.probe ? <ProbeView p={it.probe} /> : <p className="text-xs text-muted-foreground">No think-aloud on this question.</p>}</div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function ProbeView({ p }: { p: NonNullable<AttemptDetail["items"][number]["probe"]> }) {
  const Icon = p.mode === "voice" ? Mic : p.mode === "accommodation" ? Accessibility : Keyboard;
  const said = p.mode === "voice" ? (p.transcript ?? p.explanation) : (p.explanation ?? p.transcript);
  return (
    <div className="space-y-3 rounded-lg bg-muted/40 p-3">
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {p.mode === "voice" ? "Spoken" : p.mode === "accommodation" ? "Accommodation (not checked)" : "Typed"}
        <span className="num">confidence {p.confidenceBefore}/7{p.confidenceAfter != null ? ` then ${p.confidenceAfter}/7` : ""}</span>
      </p>
      <blockquote className="border-l-2 border-border pl-3 text-sm whitespace-pre-wrap">{said || <span className="text-muted-foreground">No explanation recorded.</span>}</blockquote>
      {p.mode === "voice" && <p className="text-xs text-muted-foreground">Transcript only: the audio is deleted once the explanation is transcribed.</p>}
      {p.counterfactualPrompt && (
        <div className="space-y-1">
          <p className="text-xs font-medium">Follow-up: {p.counterfactualPrompt}</p>
          <p className="text-sm whitespace-pre-wrap">{p.counterfactualAnswer || <span className="text-muted-foreground">No answer.</span>}</p>
          {p.counterfactualLatencyMs != null && <p className="num text-xs text-muted-foreground">started answering after {(p.counterfactualLatencyMs / 1000).toFixed(1)} s</p>}
        </div>
      )}
      {p.notes.length > 0 && (
        <p className="text-xs">
          <span className="text-gap">{p.notes.join(" · ")}</span>
          <span className="block text-muted-foreground">Consider a short spoken follow-up.</span>
        </p>
      )}
      <div>{p.finalScore != null ? <ApproveButton probeId={p.probeId} approved={p.professorApproved} score={p.finalScore} /> : <span className="text-xs text-muted-foreground">Not scored yet</span>}</div>
    </div>
  );
}
