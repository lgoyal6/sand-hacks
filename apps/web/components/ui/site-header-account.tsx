"use client";
// Right end of the public header: "Sign in" when signed out, a way back into the app when signed in.
import Link from "next/link";
import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useNav } from "@/components/ui/nav";

function SignInLinkInner({ className }: { className: string }) {
  const pathname = usePathname() ?? "/";
  const qs = useSearchParams().toString();
  const here = pathname + (qs ? `?${qs}` : "");
  const href = pathname === "/" || pathname === "/signin" ? "/signin" : `/signin?next=${encodeURIComponent(here)}`;
  return <Link href={href} className={className}>Sign in</Link>;
}

function SignInLink({ className }: { className: string }) {
  return (
    <Suspense fallback={<Link href="/signin" className={className}>Sign in</Link>}>
      <SignInLinkInner className={className} />
    </Suspense>
  );
}

export function SiteHeaderAccount() {
  const { loading, viewer } = useNav();
  const cls = "ml-1 rounded-full border border-border px-3.5 py-1.5 hover:bg-muted";
  if (loading) return <span className={`${cls} invisible`}>Sign in</span>;
  // Signed out: sign in, then come back to this page.
  if (!viewer) return <SignInLink className={cls} />;
  return viewer.role === "professor" ? (
    <Link href="/studio" className={cls}>Back to Studio</Link>
  ) : (
    <Link href="/" className={cls}>Back to my classes</Link>
  );
}
