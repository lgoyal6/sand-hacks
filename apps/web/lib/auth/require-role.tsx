// Server-side role gate for a route segment's layout: <RequireRole role="professor">{children}</RequireRole>.
import "server-only";
import Link from "next/link";
import { redirect } from "next/navigation";
import { authConfigured, getViewer, type Role } from "./server";

export async function RequireRole({ role, children }: { role: Role; children: React.ReactNode }) {
  if (!authConfigured()) return <>{children}</>; // auth off (offline dev): don't block
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");
  if (viewer.role !== role)
    return (
      <main className="flex min-h-svh items-center justify-center px-4 text-center">
        <div className="max-w-sm space-y-2">
          <h1 className="text-xl font-semibold">This page is for professors</h1>
          <p className="text-muted-foreground">You&apos;re signed in as a student. Head back to your sessions to keep learning.</p>
          <Link className="inline-block pt-2 underline" href="/">Back to learning</Link>
        </div>
      </main>
    );
  return <>{children}</>;
}
