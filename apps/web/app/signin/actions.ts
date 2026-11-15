"use server";
// Sign-in server actions. Demo sign-in never stalls: if the demo account doesn't exist yet it is created
// (sign-up) with its password from the server env, then signed in.
import { redirect } from "next/navigation";
import { auth, authConfigured, DEMO, setRole } from "@/lib/auth/server";

function safeNext(next: FormDataEntryValue | null, fallback: string) {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") ? n : fallback;
}

type AuthResult = { data?: unknown; error?: { message?: string } | null };

// Calls Neon Auth, never throws: a thrown error (network timeout, upstream 5xx) becomes { error }, so the
// action always redirects. A server action that throws makes Next answer 200 and leaves the page on /signin.
async function attempt(label: string, fn: () => Promise<AuthResult>): Promise<AuthResult> {
  for (let i = 1; i <= 2; i++) {
    const t0 = Date.now();
    try {
      const r = await fn();
      const ms = Date.now() - t0;
      if (r.error || ms > 3000) console.warn(`[auth] ${label} try ${i}: ${r.error ? `error "${r.error.message}"` : "ok"} in ${ms} ms`);
      return r;
    } catch (err) {
      console.error(`[auth] ${label} try ${i} threw after ${Date.now() - t0} ms:`, (err as Error).message);
      if (i === 2) return { error: { message: "Sign-in service didn't respond. Please try again." } };
    }
  }
  return { error: { message: "Sign-in failed" } };
}

export async function demoSignIn(formData: FormData) {
  if (!authConfigured()) redirect("/");
  const role = formData.get("role") === "professor" ? "professor" : "student";
  const acct = DEMO[role];
  const password = (role === "professor" ? process.env.DEMO_PROFESSOR_PASSWORD : process.env.DEMO_STUDENT_PASSWORD)?.trim();
  if (!password) redirect("/signin?error=demo");
  let res = await attempt(`demo ${role} sign-in`, () => auth().signIn.email({ email: acct.email, password }) as Promise<AuthResult>);
  // Only create the account when it really doesn't exist yet (not on a timeout).
  if (res.error && !/didn't respond/.test(res.error.message ?? "")) {
    const up = await attempt(`demo ${role} sign-up`, () => auth().signUp.email({ email: acct.email, password, name: acct.name }) as Promise<AuthResult>);
    if (!up.error) res = await attempt(`demo ${role} sign-in after sign-up`, () => auth().signIn.email({ email: acct.email, password }) as Promise<AuthResult>);
  }
  if (res.error) redirect(`/signin?error=${encodeURIComponent(res.error.message ?? "demo")}`);
  // Keep the demo accounts' roles in Neon (best effort).
  const userId = (res.data as { user?: { id?: string } } | null)?.user?.id;
  if (userId) await setRole(userId, role).catch(() => false);
  redirect(safeNext(formData.get("next"), role === "professor" ? "/studio" : "/"));
}

export async function emailSignIn(formData: FormData) {
  if (!authConfigured()) redirect("/");
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const mode = formData.get("mode") === "signup" ? "signup" : "signin";
  const res =
    mode === "signup"
      ? await attempt("email sign-up", () => auth().signUp.email({ email, password, name: name || "Student" }) as Promise<AuthResult>)
      : await attempt("email sign-in", () => auth().signIn.email({ email, password }) as Promise<AuthResult>);
  if (res.error) redirect(`/signin?error=${encodeURIComponent(res.error.message ?? "Sign-in failed")}&mode=${mode}`);
  redirect(safeNext(formData.get("next"), "/"));
}

export async function signOut() {
  if (authConfigured()) await auth().signOut();
  redirect("/signin");
}

// Demo accounts only: flip between the demo student and the demo professor without a manual sign-out.
export async function switchDemoRole() {
  const { getViewer } = await import("@/lib/auth/server");
  const viewer = await getViewer();
  if (!viewer?.demo) redirect("/");
  const to = viewer.role === "professor" ? "student" : "professor";
  await attempt("demo switch sign-out", async () => {
    await auth().signOut();
    return {};
  });
  const fd = new FormData();
  fd.set("role", to);
  fd.set("next", to === "professor" ? "/professor/students" : "/");
  await demoSignIn(fd);
}
