// Route protection (Next 16 proxy) via Neon Auth. Pages need a session; APIs check for themselves
// (telemetry beacons and the runner's results read must keep working). Role checks for /studio and
// /professor happen server-side in those layouts (see lib/auth/require-role.ts).
import { NextResponse, type NextRequest } from "next/server";
import { auth, authConfigured } from "@/lib/auth/server";

const passthrough = () => NextResponse.next();
const protect = authConfigured() ? auth().middleware({ loginUrl: "/signin", publicRoutes: ["/signin", "/api", "/icon.svg", "/check", "/check/api", "/study", "/study/data"] }) : null;

export default function proxy(req: NextRequest) {
  return protect ? protect(req) : passthrough();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|svg|ico|webp)$).*)"],
};
