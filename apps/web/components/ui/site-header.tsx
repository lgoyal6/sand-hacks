// Header for public pages (/check, /study). Owner: D.
import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { SiteHeaderAccount } from "@/components/ui/site-header-account";

export function SiteHeader() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-[1080px] items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <Link href="/" aria-label="Unprompted home" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Logo size={24} />
        </Link>
        <nav aria-label="Public" className="flex shrink-0 items-center gap-0.5 text-sm">
          <Link href="/check" className="hidden rounded-full px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground sm:inline-flex">
            Check a question
          </Link>
          <Link href="/study" className="rounded-full px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            The study
          </Link>
          <SiteHeaderAccount />
        </nav>
      </div>
    </header>
  );
}
