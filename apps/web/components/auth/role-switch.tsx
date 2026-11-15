"use client";
// One-click role flip for the two DEMO accounts only (renders nothing otherwise). Owner: C; placed by D in the sidebar.
import { useEffect, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { switchDemoRole } from "@/app/signin/actions";

export function RoleSwitch() {
  const [me, setMe] = useState<{ demo?: boolean; role?: "student" | "professor" } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then(setMe)
      .catch(() => setMe(null));
  }, []);
  if (!me?.demo) return null;
  const label = me.role === "professor" ? "Switch to student view" : "Switch to professor view";
  return (
    <form
      action={async () => {
        setBusy(true);
        await switchDemoRole();
      }}
    >
      <button
        id="role-switch"
        type="submit"
        disabled={busy}
        className="inline-flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        <ArrowLeftRight className="size-4" />
        {busy ? "Switching..." : label}
      </button>
    </form>
  );
}

export default RoleSwitch;
