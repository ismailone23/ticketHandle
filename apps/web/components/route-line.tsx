import { cn } from "@/lib/utils";

// The product's one signature: departure is a filled dot, arrival a ring, the track between.
// Used on the home preview, search results and the ticket, nowhere else.
export function RouteLine({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-xs text-muted-foreground",
        className,
      )}
      aria-hidden
    >
      <span className="size-2 shrink-0 rounded-full bg-primary" />
      <span className="h-px flex-1 bg-foreground/25" />
      {label ? <span className="shrink-0 tabular">{label}</span> : null}
      {label ? <span className="h-px flex-1 bg-foreground/25" /> : null}
      <span className="size-2 shrink-0 rounded-full border-2 border-primary bg-card" />
    </div>
  );
}
