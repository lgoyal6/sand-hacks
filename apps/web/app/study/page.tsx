// Public "The State of Leaked Homework" page (owner: D). Numbers come from data/open/leaked-homework-2026-11.json,
// the same open dataset offered for download. Charts are single-series bars in the brand hue with direct labels,
// hover titles and a table view.
import { promises as fs } from "node:fs";
import path from "node:path";
import Link from "next/link";
import { Download } from "lucide-react";
import { DATA_DIR } from "@/lib/db/fixtures";
import { SiteHeader } from "@/components/ui/site-header";
import { AgentAvatar } from "@/components/ui/agent-avatar";

export const metadata = {
  title: "The State of Leaked Homework · Unprompted",
  description: "84% of real textbook exercises we searched were already on homework-help sites. Method, limits and open data.",
};

interface Study {
  collected: string;
  exercises: number;
  found_on_study_sites: number;
  pct_found: number;
  answer_mentioned_in_snippet: number;
  queries: number;
  query_errors: number;
  by_subject: Record<string, { exercises: number; foundOnStudySites: number; pct: number }>;
  by_site: Record<string, { exercises: number; results: number }>;
  match_score_histogram: { bucket: string; results: number }[];
  rows: { exercise_id: string; match_type: string; query_error: boolean }[];
}

const SUBJECT: Record<string, string> = {
  statistics: "Statistics",
  calculus: "Calculus",
  biology: "Biology",
  microeconomics: "Microeconomics",
  physics: "Physics",
};
const BOOK: Record<string, string> = {
  statistics: "Introductory Statistics 2e",
  calculus: "Calculus Volume 1",
  biology: "Biology 2e",
  microeconomics: "Principles of Microeconomics 3e",
  physics: "College Physics 2e",
};

/** The published dataset is static, so it's cached (and the page prerenders). */
interface Market {
  summary: {
    collected: string;
    months: string[];
    queries: string[];
    serpCalls: number;
    queryErrors: number;
    uniquePages: number;
    byMonth: { month: string; pages: number }[];
    byPlatform: Record<string, number>;
    topServiceHosts: { host: string; pages: number }[];
  };
}

interface LeakIndex {
  collected: string;
  exercises: number;
  found_on_study_sites: number;
  pct_found: number;
  ci95: [number, number];
  unknown_due_to_errors: number;
  queries: number;
  query_errors: number;
  by_book: Record<string, { subject: string; exercises: number; found: number; pct: number; ci95: [number, number] }>;
  by_chapter: { book: string; chapter: string; exercises: number; found: number; pct: number }[];
  by_site: Record<string, { exercises: number; results: number }>;
}

async function loadIndex(): Promise<LeakIndex | null> {
  "use cache";
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIR, "open", "leak-index-2026-11.json"), "utf8"));
  } catch {
    return null;
  }
}

/** A book's rate as a bar, with its 95% confidence interval drawn as a thin whisker over the bar. */
function RateRow({ label, sub, pct, ci, n, k }: { label: string; sub?: string; pct: number; ci: [number, number]; n: number; k: number }) {
  return (
    <li className="group grid grid-cols-[150px_minmax(0,1fr)_112px] items-center gap-3 rounded-lg px-1 py-1 sm:grid-cols-[210px_minmax(0,1fr)_120px]" title={`${label}: ${k} of ${n} found, 95% CI ${ci[0]}-${ci[1]}%`} tabIndex={0}>
      <span className="min-w-0">
        <span className="block truncate text-sm">{label}</span>
        {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
      </span>
      <span className="relative h-3 w-full rounded-r-[4px] bg-muted/60">
        <span className="block h-full rounded-r-[4px] bg-brand transition-opacity group-hover:opacity-80" style={{ width: `${Math.max(1.5, pct)}%` }} />
        <span aria-hidden className="absolute top-1/2 h-px -translate-y-1/2 bg-foreground/60" style={{ left: `${ci[0]}%`, width: `${Math.max(0.5, ci[1] - ci[0])}%` }} />
        <span aria-hidden className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-foreground/60" style={{ left: `${ci[0]}%` }} />
        <span aria-hidden className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-foreground/60" style={{ left: `${ci[1]}%` }} />
      </span>
      <span className="num text-right text-sm">
        {Math.round(pct)}% <span className="text-xs text-muted-foreground">{Math.round(ci[0])}-{Math.round(ci[1])}</span>
      </span>
    </li>
  );
}

async function loadMarket(): Promise<Market | null> {
  "use cache";
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIR, "open", "agent-market-2026-11.json"), "utf8"));
  } catch {
    return null;
  }
}

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });

/** 12 thin columns anchored at the baseline, value printed above each, month under it. */
function MonthColumns({ data }: { data: { month: string; pages: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.pages));
  return (
    <div className="flex flex-col gap-2">
      <ol className="grid h-40 items-end gap-2" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
        {data.map((d) => (
          <li key={d.month} className="group flex h-full flex-col items-center justify-end gap-1" title={`${monthLabel(d.month)} ${d.month.slice(0, 4)}: ${d.pages} pages`} tabIndex={0}>
            <span className="num text-xs text-muted-foreground">{d.pages}</span>
            <span className="w-full max-w-7 rounded-t-[4px] bg-brand transition-opacity group-hover:opacity-80" style={{ height: `${(d.pages / max) * 100}%` }} />
          </li>
        ))}
      </ol>
      <ol className="grid gap-2 border-t border-border pt-1.5" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
        {data.map((d) => (
          <li key={d.month} className="text-center text-[11px] text-muted-foreground">
            {monthLabel(d.month)}
          </li>
        ))}
      </ol>
    </div>
  );
}

async function load(): Promise<Study> {
  "use cache";
  return JSON.parse(await fs.readFile(path.join(DATA_DIR, "open", "leaked-homework-2026-11.json"), "utf8"));
}

/** One horizontal bar row: label, a thin bar anchored at 0, the value printed beside it. */
function BarRow({ label, sub, value, max, display, title }: { label: string; sub?: string; value: number; max: number; display: string; title: string }) {
  const w = max ? Math.max(1.5, (value / max) * 100) : 0;
  return (
    <li className="group grid grid-cols-[150px_minmax(0,1fr)_88px] items-center gap-3 rounded-lg px-1 py-1 sm:grid-cols-[190px_minmax(0,1fr)_96px]" title={title} tabIndex={0}>
      <span className="min-w-0">
        <span className="block truncate text-sm">{label}</span>
        {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
      </span>
      <span className="h-3 w-full rounded-r-[4px] bg-muted/60">
        <span className="block h-full rounded-r-[4px] bg-brand transition-opacity group-hover:opacity-80 group-focus-visible:opacity-80" style={{ width: `${w}%` }} />
      </span>
      <span className="num text-right text-sm text-foreground">{display}</span>
    </li>
  );
}

export default async function Page() {
  const s = await load();
  const market = await loadMarket();
  const index = await loadIndex();
  const subjects = Object.entries(s.by_subject).sort((a, b) => b[1].pct - a[1].pct);
  const sites = Object.entries(s.by_site).sort((a, b) => b[1].exercises - a[1].exercises);
  const maxSite = Math.max(...sites.map(([, v]) => v.exercises));
  const unknown = s.rows.filter((r) => r.match_type === "not_found" && r.query_error).length;
  const checkable = s.exercises - unknown;
  const exact = s.match_score_histogram.find((h) => h.bucket === "1.00")?.results ?? 0;
  const totalResults = s.match_score_histogram.reduce((n, h) => n + h.results, 0);

  return (
    <div className="min-h-svh bg-background">
      <SiteHeader />
      <main className="mx-auto flex max-w-[880px] flex-col gap-14 px-6 pb-24 pt-14">
        <section className="flex flex-col gap-5">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <AgentAvatar agent="leak-scout" size={22} /> Leak study · {new Date(s.collected).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </span>
          <h1 className="text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[40px]">The State of Leaked Homework</h1>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <span className="num text-[72px] font-semibold leading-none tracking-[-0.04em] sm:text-[88px]">{Math.round(index ? index.pct_found : s.pct_found)}%</span>
            <p className="max-w-[460px] pb-2 text-[17px] leading-relaxed text-muted-foreground">
              {index
                ? `of ${index.exercises} real end-of-chapter exercises from ${Object.keys(index.by_book).length} open textbooks were already on homework-help sites (${index.found_on_study_sites} found; 95% CI ${Math.round(index.ci95[0])}-${Math.round(index.ci95[1])}%).`
                : `of real textbook exercises we searched were already on homework-help sites: ${s.found_on_study_sites} of ${s.exercises}, across 5 subjects.`}
            </p>
          </div>
          <p className="max-w-[680px] text-[16px] leading-relaxed">
            If a course reuses end-of-chapter questions, most of its answer key is a search away. The useful question isn&apos;t whether a quiz has leaked, but which questions to rewrite first.{" "}
            <Link href="/check" className="text-brand underline-offset-2 hover:underline">
              Check your own question
            </Link>
            .
          </p>
        </section>

        {index && (
          <section aria-labelledby="index" className="flex flex-col gap-6">
            <div className="flex flex-col gap-1">
              <h2 id="index" className="text-lg font-semibold">
                Textbook Leak Index
              </h2>
              <p className="max-w-[680px] text-sm leading-relaxed text-muted-foreground">
                About 50 exercises per book, sampled across chapters. Bars show the share found on homework sites; the thin line is the 95% confidence interval.
              </p>
            </div>
            <ul className="flex flex-col gap-1.5">
              {Object.entries(index.by_book)
                .sort((a, b) => b[1].pct - a[1].pct)
                .map(([book, v]) => (
                  <RateRow key={book} label={book} sub={v.subject} pct={v.pct} ci={v.ci95} n={v.exercises} k={v.found} />
                ))}
            </ul>
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted-foreground">Most-leaked chapters (3 or more exercises sampled)</span>
              <table className="w-full text-sm">
                <caption className="sr-only">Most-leaked chapters</caption>
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1.5 font-medium">#</th>
                    <th className="py-1.5 font-medium">Book</th>
                    <th className="py-1.5 font-medium">Chapter</th>
                    <th className="py-1.5 text-right font-medium">Found</th>
                    <th className="py-1.5 text-right font-medium">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {index.by_chapter.slice(0, 10).map((c, i) => (
                    <tr key={`${c.book}-${c.chapter}`}>
                      <td className="num py-1.5 text-muted-foreground">{i + 1}</td>
                      <td className="py-1.5">{c.book}</td>
                      <td className="num py-1.5">{c.chapter}</td>
                      <td className="num py-1.5 text-right">
                        {c.found}/{c.exercises}
                      </td>
                      <td className="num py-1.5 text-right">{Math.round(c.pct)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {index.queries} searches; {index.query_errors} failed{index.unknown_due_to_errors ? `, leaving ${index.unknown_due_to_errors} exercises unknown` : ""}. Exercise text was collected by a plain script that respects openstax.org&apos;s robots.txt, used only as search queries, and never stored here or in git.{" "}
              <a href="/study/data/leak-index-2026-11.csv" className="underline hover:text-foreground">
                Download the index (CSV)
              </a>
              .
            </p>
          </section>
        )}

        <section aria-labelledby="by-subject" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="by-subject" className="text-lg font-semibold">
              {index ? "Pilot study: by subject" : "By subject"}
            </h2>
            <p className="text-sm text-muted-foreground">Share of exercises found on at least one homework site.</p>
          </div>
          <ul className="flex flex-col gap-1.5">
            {subjects.map(([k, v]) => (
              <BarRow
                key={k}
                label={SUBJECT[k] ?? k}
                sub={BOOK[k]}
                value={v.pct}
                max={100}
                display={`${Math.round(v.pct)}%`}
                title={`${SUBJECT[k] ?? k}: ${v.foundOnStudySites} of ${v.exercises} exercises found`}
              />
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Calculus has 12 exercises, the others 20. Physics is likely undercounted (see limits).</p>
        </section>

        <section aria-labelledby="by-site" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="by-site" className="text-lg font-semibold">
              Where they are
            </h2>
            <p className="text-sm text-muted-foreground">Exercises found on each site. One exercise can be on several sites.</p>
          </div>
          <ul className="flex flex-col gap-1.5">
            {sites.map(([k, v]) => (
              <BarRow key={k} label={k} value={v.exercises} max={maxSite} display={String(v.exercises)} title={`${k}: ${v.exercises} exercises (${v.results} result pages)`} />
            ))}
          </ul>
          <p className="text-sm leading-relaxed">
            <span className="num font-semibold">{s.answer_mentioned_in_snippet}</span> of the {s.found_on_study_sites} found exercises had a search snippet that mentions an answer or solution. That&apos;s a floor: flashcard sites often show the answer right after the question.
          </p>
        </section>

        {market && (
          <section aria-labelledby="market" className="flex flex-col gap-6">
            <div className="flex flex-col gap-1">
              <h2 id="market" className="text-lg font-semibold">
                The agent-for-hire market
              </h2>
              <p className="max-w-[680px] text-sm leading-relaxed text-muted-foreground">
                Public pages that advertise or discuss AI agents doing LMS coursework (&quot;AI do my Canvas quiz&quot;, auto-complete extensions, &quot;take my online class&quot;). {market.summary.uniquePages} unique pages over the last 12 months.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted-foreground">Pages found per month</span>
              <MonthColumns data={market.summary.byMonth} />
            </div>
            <div className="grid gap-8 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <span className="text-xs text-muted-foreground">Where they are</span>
                <ul className="flex flex-col gap-1.5">
                  {Object.entries(market.summary.byPlatform)
                    .slice(0, 8)
                    .map(([k, v]) => (
                      <BarRow key={k} label={k} value={v} max={Math.max(...Object.values(market.summary.byPlatform))} display={String(v)} title={`${k}: ${v} pages`} />
                    ))}
                </ul>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs text-muted-foreground">Service sites and extensions found</span>
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {market.summary.topServiceHosts.slice(0, 10).map((h) => (
                    <li key={h.host} className="flex justify-between gap-3 py-1.5">
                      <span className="truncate">{h.host}</span>
                      <span className="num text-muted-foreground">{h.pages}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Method: {market.summary.queries.length} phrasings searched on Google through the Bright Data SERP API, one search per phrasing per month (Google&apos;s date range), top 20 results; a page counts once per month. Limits: a sample of what search surfaces, not a census; pages that discuss these tools count the same as ads; Google&apos;s dates can differ from posting dates; {market.summary.queryErrors} of {market.summary.serpCalls} searches failed, so months are undercounted. We store public links, hosts and months only: no titles, usernames or comments.
            </p>
          </section>
        )}

        <details className="rounded-2xl border border-border px-5 py-4">
          <summary className="cursor-pointer text-sm font-medium">Table view</summary>
          <table className="mt-4 w-full text-sm">
            <caption className="sr-only">Exercises found by subject</caption>
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1.5 font-medium">Subject</th>
                <th className="py-1.5 font-medium">Book</th>
                <th className="py-1.5 text-right font-medium">Exercises</th>
                <th className="py-1.5 text-right font-medium">Found</th>
                <th className="py-1.5 text-right font-medium">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {subjects.map(([k, v]) => (
                <tr key={k}>
                  <td className="py-1.5">{SUBJECT[k] ?? k}</td>
                  <td className="py-1.5 text-muted-foreground">{BOOK[k]}</td>
                  <td className="num py-1.5 text-right">{v.exercises}</td>
                  <td className="num py-1.5 text-right">{v.foundOnStudySites}</td>
                  <td className="num py-1.5 text-right">{Math.round(v.pct)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>

        <section aria-labelledby="method" className="grid gap-8 sm:grid-cols-2">
          <div className="flex flex-col gap-3">
            <h2 id="method" className="text-lg font-semibold">
              How we measured it
            </h2>
            <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] leading-relaxed">
              <li>
                {s.exercises} real end-of-chapter exercises from 5 OpenStax textbooks, about 20 per subject.
              </li>
              <li>
                One exact-phrase Google search per exercise through the Bright Data SERP API, plus one keyword search on homework sites only when that found nothing. {s.queries} searches in total.
              </li>
              <li>A result counts only if it&apos;s on a homework site and contains the exercise&apos;s actual question, not just a shared phrase.</li>
              <li>
                {exact} of {totalResults} results matched the text exactly. A hand check of 8 random hits found all 8 genuine.
              </li>
              <li>We stored links and match scores only: never answers, page content or the exercise text in this dataset.</li>
              <li>
                The exercise text was collected by a plain script that respects openstax.org&apos;s robots.txt and was never read by an AI model. An earlier AI-assisted copy was discarded and redone; one exercise changed outcome, so the total went from 78 to 77.
              </li>
            </ul>
          </div>
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Limits</h2>
            <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] leading-relaxed">
              <li>One search snapshot ({s.collected}). Results vary by day and region.</li>
              <li>
                {unknown} exercises are unknown because their searches failed; among the {checkable} we could check, {Math.round((s.found_on_study_sites / checkable) * 100)}% were found.
              </li>
              <li>Physics (50%) is probably undercounted: reposted physics problems often change the numbers, which an exact-phrase search misses.</li>
              <li>A match score measures text overlap, not proof of a correct answer on the page.</li>
              <li>Our web-archive watch (last 24 hours) can only see sites that put the question in the page address (Chegg, Studocu, Course Hero, Vaia), not Quizlet or Brainly.</li>
            </ul>
          </div>
        </section>

        <section aria-labelledby="data" className="flex flex-col gap-4 rounded-[20px] border border-border p-6">
          <div className="flex flex-col gap-1">
            <h2 id="data" className="text-lg font-semibold">
              Open data
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Every exercise and every result link, with the match type. No exercise text, snippets or answers. CC BY 4.0.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href="/study/data/leaked-homework-2026-11.csv" className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">
              <Download className="size-4" aria-hidden /> CSV
            </a>
            <a href="/study/data/leaked-homework-2026-11.json" className="inline-flex h-10 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium hover:bg-muted">
              <Download className="size-4" aria-hidden /> JSON
            </a>
            <a href="/study/data/LICENSE.md" className="inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
              License and notes
            </a>
          </div>
        </section>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Exercises are referenced from OpenStax textbooks (Introductory Statistics 2e, Calculus Volume 1, Biology 2e, Principles of Microeconomics 3e, College Physics 2e), © OpenStax, licensed CC BY or CC BY-NC-SA. Exercise text was used only as a search query and is not redistributed. Search results via the Bright Data SERP API.
        </p>
      </main>
    </div>
  );
}
