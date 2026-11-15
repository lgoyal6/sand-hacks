// Route protection (Next 16 proxy) via Neon Auth. Pages need a session; APIs check for themselves
// (telemetry beacons and the runner's results read must keep working). Role checks for /studio and
// /professor happen server-side in those layouts (see lib/auth/require-role.ts).
import { NextRequest, NextResponse } from "next/server";
import { auth, authConfigured } from "@/lib/auth/server";

const passthrough = () => NextResponse.next();
const protect = authConfigured() ? auth().middleware({ loginUrl: "/signin", publicRoutes: ["/signin", "/api", "/icon.svg", "/check", "/check/api", "/study", "/study/data", "/qr"] }) : null;

// Behind a TLS-terminating reverse proxy (Caddy on the Vultr box) Next sees http://, but the browser and the
// Neon Auth trusted domain are https://. Neon's middleware falls back to new URL(request.url).origin when a
// request has no Origin/Referer (direct loads, redirects), so it validated sessions with an untrusted http origin,
// got rejected, and cleared the session: users were signed out when switching pages. Rebuild the URL from the
// forwarded headers so the middleware sees the public origin. Locally they already match, so nothing changes.
function withPublicOrigin(req: NextRequest): NextRequest {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))?.split(",")[0]?.trim();
  if (!proto || !host || !/^https?$/.test(proto)) return req;
  const publicOrigin = `${proto}://${host}`;
  if (req.nextUrl.origin === publicOrigin) return req;
  return new NextRequest(new URL(req.nextUrl.pathname + req.nextUrl.search, publicOrigin), { method: req.method, headers: req.headers });
}

export default function proxy(req: NextRequest) {
  return protect ? protect(withPublicOrigin(req)) : passthrough();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|svg|ico|webp)$).*)"],
};
