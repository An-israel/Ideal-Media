import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-semibold">
        IM
      </span>
      <span className="text-base font-semibold tracking-tight">Ideal Media</span>
    </div>
  );
}
