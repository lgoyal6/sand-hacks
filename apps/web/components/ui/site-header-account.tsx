"use client";
// Right end of the public header: "Sign in" when signed out, a way back into the app when signed in.
import Link from "next/link";
import { useNav } from "@/components/ui/nav";

export function SiteHeaderAccount() {
  const { loading, viewer } = useNav();
  const cls = "ml-1 rounded-full border border-border px-3.5 py-1.5 hover:bg-muted";
  if (loading) return <span className={`${cls} invisible`}>Sign in</span>;
  if (!viewer) return <Link href="/signin" className={cls}>Sign in</Link>;
  return viewer.role === "professor" ? (
    <Link href="/studio" className={cls}>Back to Studio</Link>
  ) : (
    <Link href="/" className={cls}>Back to my classes</Link>
  );
}
