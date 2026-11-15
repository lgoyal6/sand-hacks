"use client";
// Minimal, Grok-style left sidebar: logo, New session, search, history grouped by day, profile at the bottom.
// Collapses to an icon strip. Near-white with a hairline border; no dark surfaces.
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { PanelLeftClose, PanelLeftOpen, Search, SquarePen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo as BrandLogo } from "@/components/ui/logo";

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
  /** Small set of top-level links under "New session" (e.g. Studio, Progress). */
  links?: SidebarNavLink[];
  newHref?: string;
  newLabel?: string;
  user?: { name: string; detail?: string };
  collapsed: boolean;
  onCollapsedChange: (v: boolean) => void;
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return <BrandLogo wordmark={!compact} size={compact ? 26 : 24} />;
}

export function ChatSidebar({
  groups,
  links = [],
  newHref = "/",
  newLabel = "New session",
  user,
  collapsed,
  onCollapsedChange,
}: ChatSidebarProps) {
  const pathname = usePathname() ?? "/";
  const [query, setQuery] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const q = query.trim().toLowerCase();
  const norm = groups.map((g) => ({ ...g, items: g.items.map((i) => ({ ...i, meta: i.meta ?? i.subtitle })) }));
  const shown = q
    ? norm.map((g) => ({ ...g, items: g.items.filter((i) => `${i.title} ${i.meta ?? ""}`.toLowerCase().includes(q)) })).filter((g) => g.items.length)
    : norm;

  const iconBtn =
    "grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  if (collapsed) {
    return (
      <aside aria-label="Sessions" className="hidden h-svh w-14 shrink-0 flex-col items-center gap-1 border-r border-sidebar-border bg-sidebar py-3 md:flex">
        <Link href="/" aria-label="Unprompted home" className="mb-2">
          <Logo compact />
        </Link>
        <button type="button" className={iconBtn} aria-label="Expand sidebar" onClick={() => onCollapsedChange(false)}>
          <PanelLeftOpen className="size-[18px]" />
        </button>
        <Link href={newHref} className={iconBtn} aria-label={newLabel}>
          <SquarePen className="size-[18px]" />
        </Link>
        <button type="button" className={iconBtn} aria-label="Search sessions" onClick={() => { onCollapsedChange(false); setSearching(true); }}>
          <Search className="size-[18px]" />
        </button>
        {links.map((l) => (
          <Link key={l.href} href={l.href} aria-label={l.label} className={cn(iconBtn, "[&_svg]:size-[18px]", pathname.startsWith(l.href) && "bg-sidebar-accent text-foreground")}>
            {l.icon}
          </Link>
        ))}
        {user && (
          <span className="mt-auto grid size-8 place-items-center rounded-full bg-muted text-xs font-medium" title={user.name}>
            {user.name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </aside>
    );
  }

  return (
    <aside aria-label="Sessions" className="hidden h-svh w-[260px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <Link href="/" className="rounded-lg px-1.5 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Logo />
        </Link>
        <button type="button" className={iconBtn} aria-label="Collapse sidebar" onClick={() => onCollapsedChange(true)}>
          <PanelLeftClose className="size-[18px]" />
        </button>
      </div>

      <div className="space-y-0.5 px-2">
        <Link
          href={newHref}
          className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <SquarePen className="size-4" /> {newLabel}
        </Link>
        {searching ? (
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
          <button
            type="button"
            onClick={() => setSearching(true)}
            className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <Search className="size-4" /> Search
          </button>
        )}
        {links.map((l) => {
          const active = pathname === l.href || pathname.startsWith(l.href + "/");
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground [&_svg]:size-4",
                active && "bg-sidebar-accent text-foreground",
              )}
            >
              {l.icon} {l.label}
            </Link>
          );
        })}
      </div>

      <nav className="mt-4 flex-1 space-y-5 overflow-y-auto px-2 pb-4">
        {shown.map((g) => (
          <div key={g.label}>
            <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">{g.label}</p>
            <ul>
              {g.items.map((i) => {
                const active = pathname === i.href;
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

      {user && (
        <div className="flex items-center gap-2.5 border-t border-sidebar-border px-3 py-3">
          <span className="grid size-8 place-items-center rounded-full bg-muted text-xs font-medium">{user.name.slice(0, 1).toUpperCase()}</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user.name}</p>
            {user.detail && <p className="truncate text-xs text-muted-foreground">{user.detail}</p>}
          </div>
        </div>
      )}
    </aside>
  );
}
