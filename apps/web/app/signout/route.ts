import { NextResponse } from "next/server";
import { auth, authConfigured } from "@/lib/auth/server";

// GET /signout: end the session and go back to sign-in.
export async function GET(req: Request) {
  if (authConfigured()) await auth().signOut().catch(() => {});
  return NextResponse.redirect(new URL("/signin", req.url));
}
