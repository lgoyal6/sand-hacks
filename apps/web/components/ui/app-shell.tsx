"use client";
// Page shell for non-chat pages (dashboards, lists). Same minimal light sidebar as the chat (ChatSidebar),
// then a plain title and a white content area. The navy rail, course sub-nav and breadcrumbs are retired;
// `course` and `breadcrumbs` props are still accepted so existing pages compile, but are not rendered.
// For learning screens use ChatLayout from "@/components/ui/chat".
import * as React from "react";
import { cn } from "@/lib/utils";
import { ChatSidebar, type SidebarGroup, type SidebarNavLink } from "@/components/ui/chat/chat-sidebar";

/** @deprecated The sidebar builds links from the viewer's role (components/ui/nav). Kept so imports compile. */
export const APP_LINKS: SidebarNavLink[] = [];

/** No page-specific groups by default: the sidebar adds the current class's quizzes itself. */
export const DEFAULT_GROUPS: SidebarGroup[] = [];

/** @deprecated Course sub-nav is retired. Kept so existing imports compile. */
export interface CourseNavItem {
  label: string;
  href: string;
  match?: string[];
}
/** @deprecated */
export const PROFESSOR_COURSE_NAV: CourseNavItem[] = [];
/** @deprecated */
export const STUDENT_COURSE_NAV: CourseNavItem[] = [];

export interface Crumb {
  label: string;
  href?: string;
}

export interface AppShellProps {
  children: React.ReactNode;
  /** @deprecated not rendered */
  course?: { name: string; term?: string; nav: CourseNavItem[] };
  /** @deprecated not rendered */
  breadcrumbs?: Crumb[];
  title?: string;
  /** Muted line under the title. */
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  wide?: boolean;
  groups?: SidebarGroup[];
  className?: string;
}

export function AppShell({ children, title, subtitle, actions, wide, groups = DEFAULT_GROUPS, className }: AppShellProps) {
  const [collapsed, setCollapsed] = React.useState(false);
  return (
    <div className="flex h-svh w-full overflow-hidden bg-background">
      <ChatSidebar groups={groups} collapsed={collapsed} onCollapsedChange={setCollapsed} />
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {(title || actions) && <PageHeading title={title} subtitle={subtitle} actions={actions} wide={wide} />}
        <main className={cn("mx-auto w-full flex-1 px-4 py-6 sm:px-8", !wide && "max-w-5xl", className)}>{children}</main>
      </div>
    </div>
  );
}

/** The page title block shared by AppShell and PublicShell, so public and in-app pages look the same. */
export function PageHeading({ title, subtitle, actions, wide }: { title?: string; subtitle?: React.ReactNode; actions?: React.ReactNode; wide?: boolean }) {
  return (
    <header className={cn("mx-auto flex w-full flex-wrap items-end justify-between gap-4 px-4 pb-2 pt-16 sm:px-8 md:pt-10", !wide && "max-w-5xl")}>
      <div className="min-w-0">
        {title && <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>}
        {subtitle && <p className="mt-1 text-[15px] text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
