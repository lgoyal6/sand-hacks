// Header for public pages (/check, /study). Owner: D.
import Link from "next/link";
import { Logo } from "@/components/ui/logo";

export function SiteHeader() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-[1080px] flex-wrap items-center justify-between gap-4 px-6 py-4">
        <Link href="/" aria-label="Unprompted home" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Logo size={24} />
        </Link>
        <nav aria-label="Public" className="flex items-center gap-1 text-sm">
          <Link href="/check" className="rounded-full px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            Check a question
          </Link>
          <Link href="/study" className="rounded-full px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            The study
          </Link>
          <Link href="/signin" className="ml-1 rounded-full border border-border px-3.5 py-1.5 hover:bg-muted">
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}
