"use client";
// Minimal, Grok-style left sidebar (owner: D): logo, the current class (switchable), role-based links from
// @/components/ui/nav, search, history, then the signed-in user. Collapses to an icon strip.
// Links come from the viewer's role, not from the caller, so every page shows the same nav.
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { Check, ChevronsUpDown, LogOut, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo as BrandLogo } from "@/components/ui/logo";
import { isActive, linksFor, useNav, type NavLinkDef } from "@/components/ui/nav";
import { RoleSwitch } from "@/components/auth/role-switch";

export interface SidebarItem {
  id: string;
  title: string;
  href: string;
  /** Optional muted suffix, e.g. "Practice". */
  meta?: string;
  /** Alias of meta. */
  subtitle?: string;
}

export interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}

export interface SidebarNavLink {
  label: string;
  href: string;
  icon: React.ReactNode;
}

export interface ChatSidebarProps {
  groups: SidebarGroup[];
  /** @deprecated Links come from the viewer's role (components/ui/nav). Accepted so callers compile. */
  links?: SidebarNavLink[];
  /** @deprecated */
  newHref?: string;
  /** @deprecated */
  newLabel?: string;
  /** @deprecated The signed-in viewer is shown instead. */
  user?: { name: string; detail?: string };
  collapsed: boolean;
  onCollapsedChange: (v: boolean) => void;
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return <BrandLogo wordmark={!compact} size={compact ? 26 : 24} />;
}

export function ChatSidebar({ groups, collapsed, onCollapsedChange }: ChatSidebarProps) {
  const pathname = usePathname() ?? "/";
  const nav = useNav();
  const role = nav.viewer?.role ?? null;
  const [query, setQuery] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const [switching, setSwitching] = React.useState(false);
  // Signed out with auth off (local dev): show both roles' links so every page stays reachable.
  const links: NavLinkDef[] = nav.loading ? [] : role ? linksFor(role) : [...linksFor("student"), ...linksFor("professor").map((l) => ({ ...l, section: l.section ?? "Professor" }))];
  const home = role === "professor" ? "/studio" : "/";
  const cls = nav.current;
  const classQuizIds = new Set(cls?.quizzes.map((q) => q.id) ?? []);
  const inClass = (href: string) => {
    const m = href.match(/^\/quiz\/([^/?#]+)/);
    return !m || !cls || classQuizIds.has(m[1]);
  };
  const classGroup: SidebarGroup | null = cls?.quizzes.length
    ? {
        label: "Quizzes",
        items: cls.quizzes.map((q) => ({ id: `class-${q.id}`, title: q.title, meta: cls.quizzes.filter((o) => o.title === q.title).length > 1 ? q.id : undefined, href: role === "professor" ? `/studio?quiz=${encodeURIComponent(q.id)}` : `/quiz/${q.id}` })),
      }
    : null;
  // Professors: the current class's quizzes. Students: the page's sessions, limited to the current class.
  const base = role === "professor" ? (classGroup ? [classGroup] : []) : groups.map((g) => ({ ...g, items: g.items.filter((i) => inClass(i.href)) })).filter((g) => g.items.length);
  const withClass = role !== "professor" && classGroup && !base.some((g) => g.items.some((i) => i.href.startsWith("/quiz/"))) ? [...base, classGroup] : base;
  const q = query.trim().toLowerCase();
  const norm = withClass.map((g) => ({ ...g, items: g.items.map((i) => ({ ...i, meta: i.meta ?? i.subtitle })) }));
  const shown = q
    ? norm.map((g) => ({ ...g, items: g.items.filter((i) => `${i.title} ${i.meta ?? ""}`.toLowerCase().includes(q)) })).filter((g) => g.items.length)
    : norm;
  const itemActive = (href: string) => {
    const [p, qs] = href.split("?");
    if (p !== pathname) return false;
    if (!qs) return true;
    return typeof window !== "undefined" && new URLSearchParams(window.location.search).toString() === qs;
  };

  const iconBtn =
    "grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const roleLabel = role === "professor" ? "Professor" : role === "student" ? "Student" : "Not signed in";

  if (collapsed) {
    return (
      <aside aria-label="Navigation" className="hidden h-svh w-14 shrink-0 flex-col items-center gap-1 border-r border-sidebar-border bg-sidebar py-3 md:flex">
        <Link href={home} aria-label="Unprompted home" className="mb-2">
          <Logo compact />
        </Link>
        <button type="button" className={iconBtn} aria-label="Expand sidebar" onClick={() => onCollapsedChange(false)}>
          <PanelLeftOpen className="size-[18px]" />
        </button>
        {links.map((l) => (
          <Link key={l.href} href={l.href} aria-label={l.label} title={l.label} aria-current={isActive(pathname, l, links) ? "page" : undefined} className={cn(iconBtn, "[&_svg]:size-[18px]", isActive(pathname, l, links) && "bg-sidebar-accent text-foreground")}>
            {l.icon}
          </Link>
        ))}
        {nav.viewer && (
          <span className="mt-auto grid size-8 place-items-center rounded-full bg-muted text-xs font-medium" title={`${nav.viewer.name} (${roleLabel})`}>
            {nav.viewer.name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </aside>
    );
  }

  return (
    <aside aria-label="Navigation" className="hidden h-svh w-[260px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <Link href={home} className="rounded-lg px-1.5 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Logo />
        </Link>
        <button type="button" className={iconBtn} aria-label="Collapse sidebar" onClick={() => onCollapsedChange(true)}>
          <PanelLeftClose className="size-[18px]" />
        </button>
      </div>

      {/* Current class, always visible. Switching only changes a preference cookie, never the session. */}
      {nav.classes.length > 0 && (
        <div className="px-2 pb-2">
          <button
            type="button"
            aria-expanded={switching}
            onClick={() => setSwitching((v) => !v)}
            className="flex w-full items-center gap-2 rounded-lg border border-sidebar-border bg-background px-2.5 py-1.5 text-left transition-colors hover:bg-sidebar-accent"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] text-muted-foreground">{role === "student" ? "My classes" : "Class"}</span>
              <span className="block truncate text-sm font-medium">{cls?.title}</span>
            </span>
            {nav.classes.length > 1 && <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />}
          </button>
          {switching && nav.classes.length > 1 && (
            <ul className="mt-1 rounded-lg border border-sidebar-border bg-background p-1">
              {nav.classes.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      nav.setClass(c.id);
                      setSwitching(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent"
                  >
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    {c.id === cls?.id && <Check className="size-3.5 text-brand" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="space-y-0.5 px-2">
        {nav.loading && [0, 1, 2].map((i) => <div key={i} className="h-9 animate-pulse rounded-lg bg-sidebar-accent/60" />)}
        {links.map((l, i) => {
          const active = isActive(pathname, l, links);
          const header = l.section && l.section !== links[i - 1]?.section ? l.section : null;
          return (
            <React.Fragment key={l.href}>
              {header && <p className="px-2.5 pb-1 pt-3 text-xs font-medium text-muted-foreground">{header}</p>}
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground [&_svg]:size-4",
                  active && "bg-sidebar-accent font-medium text-foreground",
                )}
              >
                {l.icon} {l.label}
              </Link>
            </React.Fragment>
          );
        })}
      </div>

      <nav aria-label="Sessions" className="mt-4 flex-1 space-y-5 overflow-y-auto px-2 pb-4">
        {norm.some((g) => g.items.length > 6) &&
          (searching ? (
            <label className="flex h-9 items-center gap-2.5 rounded-lg bg-sidebar-accent px-2.5">
              <Search className="size-4 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && (setQuery(""), setSearching(false))}
                onBlur={() => !query && setSearching(false)}
                placeholder="Search"
                aria-label="Search sessions"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </label>
          ) : (
            <button type="button" onClick={() => setSearching(true)} className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground">
              <Search className="size-4" /> Search
            </button>
          ))}
        {shown.map((g) => (
          <div key={g.label}>
            <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">{g.label}</p>
            <ul>
              {g.items.map((i) => {
                const active = itemActive(i.href);
                return (
                  <li key={i.id}>
                    <Link
                      href={i.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-8 items-center gap-2 truncate rounded-lg px-2.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
                        active && "bg-sidebar-accent font-medium text-foreground",
                      )}
                      title={i.meta ? `${i.title} · ${i.meta}` : i.title}
                    >
                      <span className="truncate">{i.title}</span>
                      {i.meta && <span className="shrink-0 text-xs text-muted-foreground">{i.meta}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {q && shown.length === 0 && <p className="px-2.5 text-sm text-muted-foreground">No sessions match.</p>}
      </nav>

      {nav.viewer && (
        <div className="space-y-2 border-t border-sidebar-border px-3 py-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-full bg-muted text-xs font-medium">{nav.viewer.name.slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{nav.viewer.name}</p>
              <p className="truncate text-xs text-muted-foreground">{roleLabel}</p>
            </div>
            <Link href="/signout" prefetch={false} aria-label="Sign out" title="Sign out" className={iconBtn}>
              <LogOut className="size-4" />
            </Link>
          </div>
          {nav.viewer.demo && <RoleSwitch />}
        </div>
      )}
    </aside>
  );
}
