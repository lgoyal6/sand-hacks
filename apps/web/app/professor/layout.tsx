// Professor-only segment (role gate added by C with Neon Auth).
import { Suspense } from "react";
import { RequireRole } from "@/lib/auth/require-role";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <RequireRole role="professor">{children}</RequireRole>
    </Suspense>
  );
}
