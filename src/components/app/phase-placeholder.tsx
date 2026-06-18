import { Construction } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/** Marks a route that is scaffolded and gated but lands in a later build phase. */
export function PhasePlaceholder({ phase, note }: { phase: string; note: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <Construction className="h-9 w-9 text-[var(--text-muted)]" />
        <p className="text-sm font-medium">{phase}</p>
        <p className="max-w-md text-sm text-[var(--text-muted)]">{note}</p>
      </CardContent>
    </Card>
  );
}
