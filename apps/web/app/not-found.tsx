// Unknown paths and notFound(): a plain page with the public header and a way home, never a bounce to /signin.
import Link from "next/link";
import { SiteHeader } from "@/components/ui/site-header";
import { HomeLink } from "@/components/ui/home-link";

export default function NotFound() {
  return (
    <div className="min-h-svh bg-background">
      <SiteHeader />
      <main className="mx-auto flex max-w-md flex-col items-center px-4 pt-24 text-center">
        <p className="num text-sm text-muted-foreground">404</p>
        <h1 className="mt-2 text-[26px] font-semibold tracking-tight">This page doesn&apos;t exist</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">The link may be old, or the address has a typo.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2 text-sm">
          <HomeLink className="rounded-full bg-primary px-4 py-2 font-medium text-primary-foreground hover:opacity-90" />
          <Link href="/check" className="rounded-full border border-border px-4 py-2 hover:bg-muted">
            Check a question
          </Link>
        </div>
      </main>
    </div>
  );
}
