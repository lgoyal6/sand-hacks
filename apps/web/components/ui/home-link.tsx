"use client";
// "Go home" for the viewer's role: the Studio for professors, the learning chat for everyone else.
import Link from "next/link";
import { homeFor, useNav } from "@/components/ui/nav";

export function HomeLink({ className }: { className?: string }) {
  const { viewer } = useNav();
  return (
    <Link href={homeFor(viewer?.role ?? null)} className={className}>
      {viewer?.role === "professor" ? "Back to Studio" : "Go to the home page"}
    </Link>
  );
}
