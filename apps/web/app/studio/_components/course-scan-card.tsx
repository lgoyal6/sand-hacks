"use client";
// Scan my course website (owner: B; scanner: A's coursescan). Consent first: the scan runs only when the
// professor confirms they own or teach the site. Leaked problems get "Write a new version", which asks for
// the correct answer (a posted problem has no key) and then runs the usual rewrite.
import { useState } from "react";
import { LeakRadar } from "@/components/dashboard/leak-radar";
import { PillButton, Thinking } from "@/components/ui/chat";
import { studioFetch } from "../_lib/replay-client";
import type { CourseScanRow, CourseScanView } from "../_lib/coursescan";

const field = "h-9 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function CourseScanCard({ defaultUrl = "", onRewrite }: { defaultUrl?: string; onRewrite: (quizId: string, itemId: string, label: string) => void }) {
  const [url, setUrl] = useState(defaultUrl);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<CourseScanView | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [skill, setSkill] = useState("");
  const [saving, setSaving] = useState(false);

  const scan = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await studioFetch("/studio/api/coursescan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, consent }) });
      const j = (await r.json().catch(() => ({}))) as CourseScanView & { error?: string };
      if (!r.ok) setError(j.error ?? `Scan failed (${r.status}).`);
      else setView(j);
    } catch {
      setError("Lost the connection to the scan.");
    } finally {
      setBusy(false);
    }
  };

  const rewrite = async (row: CourseScanRow, label: string) => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/studio/api/coursescan/rewrite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ row: { id: row.id, stem: row.stem }, answer, skill }) });
      const j = (await r.json().catch(() => ({}))) as { quizId?: string; itemId?: string; error?: string };
      if (!r.ok || !j.quizId || !j.itemId) return setError(j.error ?? "Couldn't save that problem.");
      setOpen(null);
      setAnswer("");
      setSkill("");
      onRewrite(j.quizId, j.itemId, label);
    } finally {
      setSaving(false);
    }
  };

  if (!view) {
    return (
      <div className="rounded-[20px] border border-border bg-background px-4 py-3.5">
        <p className="text-[15px] font-medium">Scan my course website</p>
        <p className="mt-1 text-sm text-muted-foreground">
          We read the public pages of your course site (at most 30 pages, 1 per second, robots.txt respected, no LMS or login pages), pull out up to 25 posted problems, and check each one against the open web.
        </p>
        <input className={`${field} mt-3`} placeholder="https://your-course-site.edu/stats101/" value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy} />
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={busy} />
          I own or teach this site. Only scan sites you own or teach.
        </label>
        <div className="mt-3">
          {busy ? (
            <Thinking label="Reading your course pages and searching the web (about a minute)" />
          ) : (
            <PillButton variant="primary" onClick={() => void scan()} disabled={!consent || !url.trim()}>
              Scan the site
            </PillButton>
          )}
        </div>
        {error ? <p className="mt-2 text-sm text-muted-foreground">{error}</p> : null}
      </div>
    );
  }

  const { card, radar } = view;
  // Count only matches that contain the question's actual ask (D's radar rule), so the headline and the
  // radar agree; phrase-only matches are reported separately as worth a look.
  const leakedRows = radar.items.filter((i) => i.hits.some((h) => !h.partial));
  const partialOnly = radar.items.filter((i) => i.hits.length && i.hits.every((h) => h.partial)).length;
  return (
    <div>
      <p>
        <strong>
          {leakedRows.length} of your {card.problems} posted problem{card.problems === 1 ? "" : "s"} {leakedRows.length === 1 ? "is" : "are"} already online.
        </strong>{" "}
        {partialOnly ? `${partialOnly} more share${partialOnly === 1 ? "s" : ""} a phrase with something online, worth a look. ` : ""}
        {leakedRows.length ? "A rewrite keeps the skill and changes what's being asked, so a copied answer won't match." : ""}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {card.pagesScanned} page{card.pagesScanned === 1 ? "" : "s"} read on {card.site}
        {card.pagesSkipped.length ? `, ${card.pagesSkipped.length} skipped (${[...new Set(card.pagesSkipped.map((p) => p.reason))].join(", ")})` : ""}. We keep only hashes and links, not your problem text.
      </p>
      <div className="mt-3">
        <LeakRadar data={radar} />
      </div>
      {leakedRows.length ? (
        <div className="mt-3 space-y-2">
          {leakedRows.map((i) => {
            const row = card.rows.find((r) => r.id === i.itemId)!;
            return open === i.itemId ? (
              <div key={i.itemId} className="rounded-xl border border-border px-3 py-2.5">
                <p className="text-sm">
                  {i.label}: {row.stem}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">A posted problem has no answer key, and a rewrite must reproduce it. What&apos;s the correct answer?</p>
                <input className={`${field} mt-2`} placeholder="Correct answer, e.g. 2 or 0.25" value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={saving} />
                <input className={`${field} mt-2`} placeholder="Skill it checks (optional)" value={skill} onChange={(e) => setSkill(e.target.value)} disabled={saving} />
                <div className="mt-2 flex gap-2">
                  <PillButton variant="primary" onClick={() => void rewrite(row, i.label)} disabled={saving || !answer.trim()}>
                    {saving ? "Saving" : "Write a new version"}
                  </PillButton>
                  <PillButton variant="secondary" onClick={() => setOpen(null)} disabled={saving}>
                    Cancel
                  </PillButton>
                </div>
              </div>
            ) : (
              <PillButton key={i.itemId} variant="primary" onClick={() => setOpen(i.itemId)}>
                Write a new version of {i.label}
              </PillButton>
            );
          })}
        </div>
      ) : null}
      {error ? <p className="mt-2 text-sm text-muted-foreground">{error}</p> : null}
    </div>
  );
}
