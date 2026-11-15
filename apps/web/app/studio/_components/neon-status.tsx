"use client";
// "Database" line for the studio side panel (owner: B): how many Neon branches exist right now.
import { useEffect, useState } from "react";
import { Database } from "lucide-react";
import type { NeonSummary } from "../_lib/neon-branches";

export function NeonStatus() {
  const [s, setS] = useState<NeonSummary | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/studio/api/neon")
        .then((r) => (r.ok ? r.json() : null))
        .then((j: NeonSummary | null) => live && j && setS(j))
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  if (!s) return null;
  return (
    <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">Database</p>
      {s.available ? (
        <p className="flex items-start gap-2">
          <Database className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            Neon: {s.main ? (
              <a href={s.main.consoleUrl} target="_blank" rel="noreferrer" className="font-medium text-foreground underline-offset-2 hover:underline">
                {s.main.name}
              </a>
            ) : (
              "main"
            )}{" "}
            + {s.experiments} experiment branch{s.experiments === 1 ? "" : "es"}
            {s.appeals ? `, ${s.appeals} appeal${s.appeals === 1 ? "" : "s"}` : ""}
            <span className="block text-[11px] text-muted-foreground/80">One branch per rewrite candidate. Listed from the Neon API, refreshed every minute.</span>
          </span>
        </p>
      ) : (
        <p>Neon branch details unavailable (no Neon API key on this server).</p>
      )}
    </div>
  );
}
