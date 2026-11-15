// Centered page-level loading state using Dat's Loader (components/ui/loader.tsx, kept verbatim). Owner: D.
import Loader from "@/components/ui/loader";

export function PageLoader({ title, subtitle, size = "md" }: { title: string; subtitle?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <div role="status" aria-live="polite" className="grid min-h-[60svh] w-full place-items-center">
      <Loader title={title} subtitle={subtitle ?? ""} size={size} />
    </div>
  );
}

export function PanelLoader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div role="status" aria-live="polite" className="grid min-h-40 w-full place-items-center rounded-lg border border-border">
      <Loader title={title} subtitle={subtitle ?? ""} size="sm" className="p-4" />
    </div>
  );
}
