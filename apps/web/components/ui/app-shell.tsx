"use client";
// Canvas-style page shell: global nav rail (far left) + optional course sub-nav + white content area
// with a breadcrumb header. Owner: D. Usage:
//   <AppShell course={{ name: "Intro Statistics", nav: PROFESSOR_COURSE_NAV }} breadcrumbs={[...]} title="Quizzes">...</AppShell>
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { BarChart3, BookOpen, FlaskConical, Gauge, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { OrbAvatar } from "@/components/ui/orb-avatar";
import { SidebarRail, SidebarRailBody, SidebarRailLink, type RailLink } from "@/components/ui/sidebar-rail";

export const GLOBAL_NAV: RailLink[] = [
  { label: "Dashboard", href: "/", icon: <LayoutDashboard /> },
  { label: "Courses", href: "/course", icon: <BookOpen />, match: ["/quiz"] },
  { label: "Studio", href: "/studio", icon: <FlaskConical /> },
  { label: "Insights", href: "/professor", icon: <BarChart3 /> },
  { label: "Progress", href: "/progress", icon: <Gauge /> },
];

export interface CourseNavItem {
  label: string;
  href: string;
  /** Extra path prefixes that mark this item active. */
  match?: string[];
}

/** Course-level sub-nav for professors. */
export const PROFESSOR_COURSE_NAV: CourseNavItem[] = [
  { label: "Home", href: "/course" },
  { label: "Assignments", href: "/course/assignments" },
  { label: "Quizzes", href: "/course/quizzes", match: ["/quiz"] },
  { label: "Grades", href: "/professor" },
  { label: "Studio", href: "/studio" },
];

/** Course-level sub-nav for students. */
export const STUDENT_COURSE_NAV: CourseNavItem[] = [
  { label: "Home", href: "/course" },
  { label: "Assignments", href: "/course/assignments" },
  { label: "Quizzes", href: "/course/quizzes", match: ["/quiz"] },
  { label: "Grades", href: "/progress" },
];

export interface Crumb {
  label: string;
  href?: string;
}

export interface AppShellProps {
  children: React.ReactNode;
  /** Course context: shows the course sub-nav column. */
  course?: { name: string; term?: string; nav: CourseNavItem[] };
  breadcrumbs?: Crumb[];
  /** Page title shown under the breadcrumbs. */
  title?: string;
  /** Right side of the page header (buttons). */
  actions?: React.ReactNode;
  /** Remove the content max width (wide dashboards). */
  wide?: boolean;
  className?: string;
}

function itemActive(pathname: string, item: CourseNavItem) {
  return [item.href, ...(item.match ?? [])].some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function CourseNav({ name, term, nav }: { name: string; term?: string; nav: CourseNavItem[] }) {
  const pathname = usePathname() ?? "/";
  // The most specific match wins, so /course/quizzes doesn't also light up Home.
  const active = nav
    .filter((i) => itemActive(pathname, i))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return (
    <aside aria-label="Course" className="hidden w-52 shrink-0 border-r border-border bg-sidebar px-3 py-5 lg:block">
      <div className="mb-4 px-2">
        <p className="truncate text-sm font-semibold text-sidebar-foreground">{name}</p>
        {term && <p className="text-xs text-muted-foreground">{term}</p>}
      </div>
      <nav className="flex flex-col">
        {nav.map((item) => {
          const isActive = item === active;
          return (
            <Link
              key={item.href + item.label}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "border-l-2 border-transparent px-2 py-1.5 text-sm text-primary hover:underline",
                isActive && "border-l-foreground font-medium text-foreground hover:no-underline",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <React.Fragment key={c.label + i}>
            {i > 0 && <span className="text-muted-foreground">›</span>}
            {c.href && !last ? (
              <Link href={c.href} className="truncate text-primary hover:underline">
                {c.label}
              </Link>
            ) : (
              <span className={cn("truncate", last ? "text-foreground" : "text-muted-foreground")} aria-current={last ? "page" : undefined}>
                {c.label}
              </span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

export function AppShell({ children, course, breadcrumbs, title, actions, wide, className }: AppShellProps) {
  return (
    <div className="flex min-h-svh w-full flex-col bg-background md:flex-row">
      <SidebarRail>
        <SidebarRailBody>
          <Link href="/" className="mb-3 flex h-12 items-center gap-3 px-2" aria-label="Unprompted home">
            <span className="flex w-[44px] shrink-0 justify-center">
              <OrbAvatar size="sm" color="blue" />
            </span>
            <span className="whitespace-pre text-sm font-semibold">Unprompted</span>
          </Link>
          {GLOBAL_NAV.map((l) => (
            <SidebarRailLink key={l.href} link={l} />
          ))}
        </SidebarRailBody>
      </SidebarRail>
      {course && <CourseNav {...course} />}
      <div className="flex min-w-0 flex-1 flex-col">
        {(breadcrumbs || title || actions) && (
          <header className="border-b border-border px-6 py-4">
            <div className={cn("mx-auto flex w-full items-end justify-between gap-4", !wide && "max-w-6xl")}>
              <div className="min-w-0 space-y-1">
                {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
                {title && <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>}
              </div>
              {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
            </div>
          </header>
        )}
        <main className={cn("mx-auto w-full flex-1 px-6 py-6", !wide && "max-w-6xl", className)}>{children}</main>
      </div>
    </div>
  );
}
