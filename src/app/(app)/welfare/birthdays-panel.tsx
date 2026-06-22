import { Cake, Gift } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buildWhatsAppLink } from "@/lib/utils";
import type { BirthdayPerson } from "@/lib/welfare-queries";

export function BirthdaysPanel({
  today,
  upcoming,
}: {
  today: BirthdayPerson[];
  upcoming: BirthdayPerson[];
}) {
  if (today.length === 0 && upcoming.length === 0) return null;

  return (
    <div className="mb-6 space-y-3">
      {today.length > 0 && (
        <Card className="border-[var(--accent)]/40 bg-[var(--accent)]/5">
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <span className="flex items-center gap-2 text-sm font-medium text-[var(--accent)]">
              <Cake className="h-4 w-4" /> Today&apos;s birthday{today.length > 1 ? "s" : ""}:
            </span>
            {today.map((p, i) => (
              <span key={i} className="flex items-center gap-1.5 text-sm">
                {p.name}
                {p.whatsapp && (
                  <a
                    href={buildWhatsAppLink(p.whatsapp, `Happy birthday, ${p.name}! 🎉 From the media team.`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--accent)] underline-offset-2 hover:underline"
                  >
                    wish 🎉
                  </a>
                )}
              </span>
            ))}
          </CardContent>
        </Card>
      )}

      {upcoming.length > 0 && (
        <Card>
          <CardContent className="py-3.5">
            <p className="mb-2 flex items-center gap-2 text-xs font-medium text-[var(--text-muted)]">
              <Gift className="h-3.5 w-3.5" /> Upcoming birthdays
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-[var(--text-muted)]">
              {upcoming.map((p, i) => (
                <span key={i}>
                  <span className="text-[var(--text)]">{p.name}</span> · {p.label}
                  {p.daysUntil === 1 ? " (tomorrow)" : ` (${p.daysUntil}d)`}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
