// Where "home" is for each role. Plain module (no "use client"), so server pages and client components share it:
// the logo, sign-in, the demo role switch and the 404 page all agree.
export function homeFor(role: "student" | "professor" | null | undefined) {
  return role === "professor" ? "/studio" : "/";
}
