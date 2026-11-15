// Neon Auth proxy (same-origin): the browser client and server actions talk to Managed Better Auth through here.
import { NextResponse } from "next/server";
import { auth, authConfigured } from "@/lib/auth/server";

const off = () => NextResponse.json({ error: "Sign-in is not configured" }, { status: 503 });
const h = authConfigured() ? auth().handler() : null;

export const GET = h ? h.GET : off;
export const POST = h ? h.POST : off;
