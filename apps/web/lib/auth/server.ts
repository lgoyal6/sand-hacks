// Neon Auth (Managed Better Auth) for Unprompted. Server only.
// Roles are app-level: professors come from PROFESSOR_EMAILS (comma list; the demo professor is always one),
// everyone else is a student. Students are identified by a pseudonym derived from their user id, never by email.
import "server-only";
import { createHash } from "node:crypto";
import { createNeonAuth } from "@neon/auth/next/server";
import { connection } from "next/server";
import { neon } from "@/lib/db/neon";

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

// Roles live in Neon (user_role, owner B). Until that table exists or has a row for the user,
// the PROFESSOR_EMAILS allowlist (plus the demo professor) decides.
async function dbRole(userId: string): Promise<Role | null> {
  const db = neon();
  if (!db) return null;
  try {
    const { rows } = await db.query<{ role: Role }>("select role from user_role where user_id = $1", [userId]);
    return rows[0]?.role ?? null;
  } catch {
    return null; // table not there yet
  }
}

export async function setRole(userId: string, role: Role) {
  const db = neon();
  if (!db) return false;
  try {
    await db.query("insert into user_role (user_id, role) values ($1, $2) on conflict (user_id) do update set role = excluded.role", [userId, role]);
    return true;
  } catch {
    return false;
  }
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
  // A session only exists at request time: opt the caller out of prerendering explicitly,
  // instead of letting cookies() reject during the build.
  await connection();
  try {
    const { data } = await auth().getSession();
    const u = data?.user;
    if (!u) return null;
    const demo = u.email === DEMO.student.email || u.email === DEMO.professor.email;
    const role = (await dbRole(u.id)) ?? roleFor(u.email);
    return { userId: u.id, name: u.name || "Student", role, pseudonym: pseudonymFor(u.id), demo };
  } catch (err) {
    console.error("[auth] getSession failed:", (err as Error).message);
    return null;
  }
}
