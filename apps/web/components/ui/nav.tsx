"use client";
// One source of truth for the sidebar (owner: D): links per role, the signed-in viewer, and the current class.
// Every page's sidebar (AppShell, ChatLayout, Studio) reads from here, so the nav is the same everywhere.
import * as React from "react";
import { usePathname } from "next/navigation";
import { BarChart3, FlaskConical, Gauge, Search, ScanSearch, SquarePen, Users } from "lucide-react";
import type { NavClass } from "@/app/api/nav/route";

export type NavRole = "student" | "professor";
export interface NavViewer {
  name: string;
  role: NavRole;
  demo: boolean;
}
export interface NavLinkDef {
  label: string;
  href: string;
  icon: React.ReactNode;
  /** Other path prefixes that should light this link up. */
  match?: string[];
  section?: string;
}

/** Student: New session, Your progress. Professor: Studio, Students, Insights, then public tools. */
export function linksFor(role: NavRole | null): NavLinkDef[] {
  if (role === "professor")
    return [
      { label: "Studio", href: "/studio", icon: <FlaskConical /> },
      { label: "Students", href: "/professor/students", icon: <Users /> },
      { label: "Insights", href: "/professor", icon: <BarChart3 />, match: ["/professor/design"] },
      { label: "Leak checker", href: "/check", icon: <Search />, section: "Public tools" },
      { label: "Leak study", href: "/study", icon: <ScanSearch />, section: "Public tools" },
    ];
  return [
    { label: "New session", href: "/", icon: <SquarePen />, match: ["/quiz"] },
    { label: "Your progress", href: "/progress", icon: <Gauge /> },
  ];
}

/** Exact match, or a sub-path; "/professor" must not light up for "/professor/students". */
export function isActive(pathname: string, l: NavLinkDef, all: NavLinkDef[]) {
  const hit = (href: string) => pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
  if (!hit(l.href) && !(l.match ?? []).some(hit)) return false;
  // Defer to a more specific link that also matches.
  return !all.some((o) => o !== l && o.href.length > l.href.length && hit(o.href));
}

const COOKIE = "unprompted_class";
const readCookie = () => (typeof document === "undefined" ? null : (document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]*)`))?.[1] ?? null));

interface NavState {
  loading: boolean;
  viewer: NavViewer | null;
  classes: NavClass[];
}
// Last answer, shown at once on the next page so the sidebar doesn't flash; always refreshed on mount, so a
// sign-in, sign-out or demo role switch shows up on the very next page.
let last: Omit<NavState, "loading"> | null = null;
const listeners = new Set<() => void>();

function load(): Promise<Omit<NavState, "loading">> {
  return fetch("/api/nav", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { viewer: null, classes: [] }))
    .catch(() => last ?? { viewer: null, classes: [] })
    .then((d) => (last = d));
}

export function useNav() {
  const [state, setState] = React.useState<NavState>(() => (last ? { loading: false, ...last } : { loading: true, viewer: null, classes: [] }));
  const pathname = usePathname();
  const [classId, setClassId] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    void load().then((d) => live && setState({ loading: false, ...d }));
    const sync = () => setClassId(decodeURIComponent(readCookie() ?? ""));
    sync();
    listeners.add(sync);
    return () => {
      live = false;
      listeners.delete(sync);
    };
  }, [pathname]);
  const current = state.classes.find((c) => c.id === classId) ?? state.classes[0] ?? null;
  const setClass = React.useCallback((id: string) => {
    // A plain preference cookie: no auth involved.
    document.cookie = `${COOKIE}=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`;
    listeners.forEach((f) => f());
  }, []);
  return { ...state, current, setClass };
}
