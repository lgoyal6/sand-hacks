// Neon Auth (Managed Better Auth) for Unprompted. Server only.
// Roles are app-level: professors come from PROFESSOR_EMAILS (comma list; the demo professor is always one),
// everyone else is a student. Students are identified by a pseudonym derived from their user id, never by email.
import "server-only";
import { createHash } from "node:crypto";
import { createNeonAuth } from "@neon/auth/next/server";

export type Role = "student" | "professor";

export const DEMO = {
  student: { email: "demo-student@unprompted.test", name: "Demo Student" },
  professor: { email: "demo-professor@unprompted.test", name: "Demo Professor" },
} as const;

export function authConfigured() {
  return Boolean(process.env.NEON_AUTH_BASE_URL?.trim() && process.env.NEON_AUTH_COOKIE_SECRET?.trim());
}

let instance: ReturnType<typeof createNeonAuth> | null = null;
export function auth() {
  if (!authConfigured()) throw new Error("Neon Auth is not configured (NEON_AUTH_BASE_URL / NEON_AUTH_COOKIE_SECRET)");
  instance ??= createNeonAuth({
    baseUrl: process.env.NEON_AUTH_BASE_URL!.trim(),
    cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET!.trim() },
  });
  return instance;
}

export function roleFor(email: string | null | undefined): Role {
  const list = (process.env.PROFESSOR_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const e = (email ?? "").toLowerCase();
  return e && (e === DEMO.professor.email || list.includes(e)) ? "professor" : "student";
}

/** Stable, non-reversible student pseudonym from the auth user id. */
export function pseudonymFor(userId: string) {
  return `s-${createHash("sha256").update(`unprompted:${userId}`).digest("hex").slice(0, 10)}`;
}

export interface Viewer {
  userId: string;
  name: string;
  role: Role;
  pseudonym: string;
  demo: boolean;
}

/** The signed-in viewer, or null (auth off, no session, or auth unreachable). Never exposes the email. */
export async function getViewer(): Promise<Viewer | null> {
  if (!authConfigured()) return null;
  try {
    const { data } = await auth().getSession();
    const u = data?.user;
    if (!u) return null;
    const demo = u.email === DEMO.student.email || u.email === DEMO.professor.email;
    return { userId: u.id, name: u.name || "Student", role: roleFor(u.email), pseudonym: pseudonymFor(u.id), demo };
  } catch (err) {
    console.error("[auth] getSession failed:", (err as Error).message);
    return null;
  }
}
