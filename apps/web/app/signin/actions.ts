"use server";
// Sign-in server actions. Demo sign-in never stalls: if the demo account doesn't exist yet it is created
// (sign-up) with its password from the server env, then signed in.
import { redirect } from "next/navigation";
import { auth, authConfigured, DEMO, setRole } from "@/lib/auth/server";

function safeNext(next: FormDataEntryValue | null, fallback: string) {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") ? n : fallback;
}

export async function demoSignIn(formData: FormData) {
  if (!authConfigured()) redirect("/");
  const role = formData.get("role") === "professor" ? "professor" : "student";
  const acct = DEMO[role];
  const password = (role === "professor" ? process.env.DEMO_PROFESSOR_PASSWORD : process.env.DEMO_STUDENT_PASSWORD)?.trim();
  if (!password) redirect("/signin?error=demo");
  let res = await auth().signIn.email({ email: acct.email, password });
  if (res.error) {
    await auth().signUp.email({ email: acct.email, password, name: acct.name });
    res = await auth().signIn.email({ email: acct.email, password });
  }
  if (res.error) redirect(`/signin?error=${encodeURIComponent(res.error.message ?? "demo")}`);
  // Keep the demo accounts' roles in Neon (no-op until user_role exists).
  const userId = (res.data as { user?: { id?: string } } | null)?.user?.id;
  if (userId) await setRole(userId, role);
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
      ? await auth().signUp.email({ email, password, name: name || "Student" })
      : await auth().signIn.email({ email, password });
  if (res.error) redirect(`/signin?error=${encodeURIComponent(res.error.message ?? "Sign-in failed")}&mode=${mode}`);
  redirect(safeNext(formData.get("next"), "/"));
}

export async function signOut() {
  if (authConfigured()) await auth().signOut();
  redirect("/signin");
}
