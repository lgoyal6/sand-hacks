import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/server";

// Who is signed in (never the email): for the sidebar role switch and nav.
export async function GET() {
  const v = await getViewer();
  return NextResponse.json(v ? { signedIn: true, name: v.name, role: v.role, demo: v.demo, pseudonym: v.pseudonym } : { signedIn: false });
}
