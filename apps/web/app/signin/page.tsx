// Owner: C. Sign in: one-click demo accounts (so the demo never stalls) or email and password.
import { Suspense } from "react";
import { demoSignIn, emailSignIn } from "./actions";
import { Logo } from "@/components/ui/quiz";

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "";
  const error = typeof sp.error === "string" ? sp.error : null;
  const signup = sp.mode === "signup";
  // The email form is not rendered at all by default: any password field makes the browser's password manager
  // (and on macOS, the Keychain) look up saved logins. Demo sign-in has no password field.
  const showEmail = sp.email === "1" || signup || Boolean(error && error !== "demo");
  return (
    <div className="w-full max-w-sm space-y-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <Logo />
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to Unprompted</h1>
      </div>

      <div className="space-y-2">
        <form action={demoSignIn}>
          <input type="hidden" name="role" value="student" />
          <input type="hidden" name="next" value={next} />
          <button id="demo-student" type="submit" className="h-11 w-full rounded-full bg-primary text-sm font-medium text-primary-foreground hover:opacity-90">
            Continue as demo student
          </button>
        </form>
        <form action={demoSignIn}>
          <input type="hidden" name="role" value="professor" />
          <input type="hidden" name="next" value={next} />
          <button id="demo-professor" type="submit" className="h-11 w-full rounded-full border text-sm font-medium hover:bg-muted">
            Continue as demo professor
          </button>
        </form>
      </div>

      {showEmail ? (
        <form action={emailSignIn} className="space-y-3">
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="mode" value={signup ? "signup" : "signin"} />
          {signup && (
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">Name</span>
              <input id="signin-name" name="name" autoComplete="name" className="h-10 w-full rounded-lg border bg-transparent px-3" />
            </label>
          )}
          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground">Email</span>
            <input id="signin-email" name="email" type="email" required autoComplete="email" className="h-10 w-full rounded-lg border bg-transparent px-3" />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground">Password</span>
            <input id="signin-password" name="password" type="password" required minLength={8} autoComplete={signup ? "new-password" : "current-password"} className="h-10 w-full rounded-lg border bg-transparent px-3" />
          </label>
          <button id="signin-submit" type="submit" className="h-10 w-full rounded-full border text-sm font-medium hover:bg-muted">
            {signup ? "Create account" : "Sign in"}
          </button>
          <p className="text-center text-sm text-muted-foreground">
            {signup ? (
              <a className="underline" href={`/signin?email=1${next ? `&next=${encodeURIComponent(next)}` : ""}`}>I already have an account</a>
            ) : (
              <a className="underline" href={`/signin?mode=signup${next ? `&next=${encodeURIComponent(next)}` : ""}`}>Create an account</a>
            )}
          </p>
        </form>
      ) : (
        <p className="text-center text-sm">
          <a id="signin-email-link" className="text-muted-foreground underline-offset-2 hover:underline" href={`/signin?email=1${next ? `&next=${encodeURIComponent(next)}` : ""}`}>
            Sign in with email instead
          </a>
        </p>
      )}
      {error && <p role="alert" className="text-center text-sm text-destructive">{error === "demo" ? "Demo sign-in isn't set up on this server." : error}</p>}
    </div>
  );
}

export default function SignInPage({ searchParams }: PageProps<"/signin">) {
  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <Suspense fallback={null}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
