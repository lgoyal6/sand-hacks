// Unprompted logo (owner: D): "the face". A solid ink circle, two pill eyes, one small blue dot.
// Small sizes (<= 20px) drop the dot so the eyes stay legible. Use <Logo /> for mark + wordmark.
import { cn } from "@/lib/utils";

export function FaceMark({
  size = 28,
  tone = "ink",
  className,
  title = "Unprompted",
}: {
  size?: number;
  /** "ink" on light backgrounds, "paper" on dark ones. */
  tone?: "ink" | "paper";
  className?: string;
  title?: string;
}) {
  const body = tone === "ink" ? "#111418" : "#ffffff";
  const eye = tone === "ink" ? "#ffffff" : "#111418";
  const tiny = size <= 20;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={title} className={cn("shrink-0", className)}>
      <title>{title}</title>
      {tiny ? (
        <>
          <circle cx="24" cy="24" r="22.5" fill={body} />
          <rect x="14.5" y="14" width="6.5" height="14" rx="3.25" fill={eye} />
          <rect x="27" y="14" width="6.5" height="14" rx="3.25" fill={eye} />
        </>
      ) : (
        <>
          <circle cx="24" cy="24" r="21" fill={body} />
          <rect x="16.5" y="17" width="4.4" height="10" rx="2.2" fill={eye} />
          <rect x="27.1" y="17" width="4.4" height="10" rx="2.2" fill={eye} />
          <circle cx="35" cy="35" r="5" fill="#2f6bed" stroke={tone === "ink" ? "#ffffff" : "#111418"} strokeWidth="2.5" />
        </>
      )}
    </svg>
  );
}

export function Logo({ size = 26, tone = "ink", wordmark = true, className }: { size?: number; tone?: "ink" | "paper"; wordmark?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <FaceMark size={size} tone={tone} />
      {wordmark && (
        <span className={cn("text-[16px] font-semibold tracking-[-0.025em]", tone === "paper" ? "text-white" : "text-foreground")}>unprompted</span>
      )}
    </span>
  );
}
