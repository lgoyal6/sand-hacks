import { cn } from "@/lib/utils";

/** Marks a view that is rendering fixture data rather than live results. Required on every fixture-backed view. */
export function SampleBadge({ className, label = "Sample data" }: { className?: string; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border border-dashed border-muted-foreground/40 px-2 text-[11px] font-medium text-muted-foreground",
        className,
      )}
      title="This view uses fixture data, not live results."
    >
      {label}
    </span>
  );
}
