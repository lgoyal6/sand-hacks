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

// Only the app's real signed-in pages need a session. Anything else (an unknown path, a typo) falls through
// to Next, so it gets the normal 404 page instead of a bounce to /signin.
const PROTECTED = [
  /^\/$/,
  /^\/quiz\/[^/]+\/?$/,
  /^\/progress\/?$/,
  /^\/course\/?$/,
  /^\/studio\/?$/,
  /^\/studio\/api\//,
  /^\/professor\/?$/,
  /^\/professor\/students(\/[^/]+)?\/?$/,
  /^\/professor\/design(\/(agents|cards|student))?\/?$/,
  /^\/professor\/(api|screens)\//,
];
const isProtectedPath = (pathname: string) => PROTECTED.some((r) => r.test(pathname));

export default async function proxy(req: NextRequest) {
  if (!protect || !isProtectedPath(req.nextUrl.pathname)) return passthrough();
  const res = await protect(withPublicOrigin(req));
  // Neon Auth's redirect to /signin keeps the query string but drops the page. Add ?next= so sign-in
  // returns to the page that was asked for (the sign-in actions only accept same-site paths).
  const location = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && location) {
    const to = new URL(location, req.nextUrl.origin);
    if (to.pathname === "/signin" && !to.searchParams.has("next")) {
      // The page's own query (?quiz=, ?mode=) belongs inside next, not on /signin itself.
      const asked = req.nextUrl.pathname + req.nextUrl.search;
      to.search = "";
      if (asked !== "/") to.searchParams.set("next", asked);
      res.headers.set("location", to.toString());
    }
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|svg|ico|webp)$).*)"],
};
