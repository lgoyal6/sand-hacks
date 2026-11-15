"use client";
// Shell for the public tools (/check, /study). Owner: D. Signed in: the normal app layout with the sidebar.
// Signed out: the public header, with the same title block, width and spacing as the app.
import * as React from "react";
import { cn } from "@/lib/utils";
import { AppShell, PageHeading } from "@/components/ui/app-shell";
import { SiteHeader } from "@/components/ui/site-header";
import { useNav } from "@/components/ui/nav";

export function PublicShell({ title, subtitle, actions, children }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) {
  const { viewer } = useNav();
  if (viewer)
    return (
      <AppShell title={title} subtitle={subtitle} actions={actions}>
        {children}
      </AppShell>
    );
  return (
    <div className="min-h-svh bg-background">
      <SiteHeader />
      <div className="[&>header]:pt-8 md:[&>header]:pt-10">
        <PageHeading title={title} subtitle={subtitle} actions={actions} />
      </div>
      <main className={cn("mx-auto w-full max-w-5xl px-4 py-6 sm:px-8")}>{children}</main>
    </div>
  );
}
