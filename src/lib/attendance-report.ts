import {
  ABSENCE_REASON_ORDER,
  reasonHeading,
  type AbsenceReason,
} from "@/lib/absence-reasons";

/**
 * Builds the department's weekly attendance message from recorded data.
 *
 * The output is a deliberate match for the report the team has been typing by
 * hand — same greeting, same heading order, same "Name: note" lines — so it can
 * be copied straight into the Pastors' chat and nobody has to learn a new
 * format. The whole point is that the typing stops, not that the report changes.
 */

export interface ReportPerson {
  userId: string;
  fullName: string;
  subunitName: string | null;
  status: "present" | "absent" | "traveled" | "excused";
  absenceReason: AbsenceReason | null;
  absenceNote: string | null;
}

export interface SubunitBreakdownRow {
  subunitName: string;
  total: number;
  present: number;
  absent: number;
  submitted: boolean;
  late: boolean;
  noService: boolean;
}

export interface AttendanceReport {
  activityName: string;
  serviceDate: string;
  totalMembers: number;
  present: number;
  absent: number;
  onIt: number;
  categories: {
    reason: AbsenceReason;
    heading: string;
    people: { fullName: string; note: string | null }[];
  }[];
  subunits: SubunitBreakdownRow[];
  /** Subunits with nothing recorded — the chase list. */
  missingSubunits: string[];
}

/** Everything that is not 'present' counts as absent in the headline figure. */
function isAbsent(p: ReportPerson) {
  return p.status !== "present";
}

export function buildReport(input: {
  activityName: string;
  serviceDate: string;
  people: ReportPerson[];
  subunits: SubunitBreakdownRow[];
}): AttendanceReport {
  const { people } = input;
  const absentees = people.filter(isAbsent);

  const grouped = new Map<AbsenceReason, { fullName: string; note: string | null }[]>();
  for (const p of absentees) {
    // An absence with no category recorded still has to appear somewhere, or
    // the categories would not sum to the absent total and the report would
    // quietly under-report. "Other Reasons" is where it lands.
    const reason = p.absenceReason ?? "other";
    const list = grouped.get(reason) ?? [];
    list.push({ fullName: p.fullName, note: p.absenceNote });
    grouped.set(reason, list);
  }

  const categories = ABSENCE_REASON_ORDER.filter((r) => (grouped.get(r)?.length ?? 0) > 0).map(
    (reason) => ({
      reason,
      heading: reasonHeading(reason),
      people: (grouped.get(reason) ?? []).sort((a, b) =>
        a.fullName.localeCompare(b.fullName)
      ),
    })
  );

  return {
    activityName: input.activityName,
    serviceDate: input.serviceDate,
    totalMembers: people.length,
    present: people.length - absentees.length,
    absent: absentees.length,
    onIt: absentees.filter((p) => p.absenceReason === "on_it").length,
    categories,
    subunits: input.subunits,
    missingSubunits: input.subunits.filter((s) => !s.submitted && !s.noService).map((s) => s.subunitName),
  };
}

/** `2026-10-04` → `4/10/2026`, the way the team writes dates. */
export function formatReportDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}/${y}`;
}

/**
 * Renders the report as the WhatsApp message.
 *
 * Asterisks are WhatsApp's bold markers, not markdown — they are intentional
 * and must survive into the clipboard.
 */
export function formatReportText(r: AttendanceReport): string {
  const lines: string[] = [];
  lines.push("Good evening Pastors and Leaders,");
  lines.push("");
  lines.push("*MEDIA UNIT ATTENDANCE & ABSENTEE REPORT*");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`*${r.activityName} Report: ${formatReportDate(r.serviceDate)}*`);
  lines.push("");
  lines.push(`* *Total Members:* ${r.totalMembers}`);
  lines.push(`* *Present:* ${r.present}`);
  lines.push(`* *Absent:* ${r.absent}`);
  if (r.onIt > 0) lines.push(`* *On IT:* ${r.onIt}`);
  lines.push("");

  if (r.absent > 0) {
    lines.push(`*Absentee Categorization (${r.absent} Total):*`);
    lines.push("");
    for (const c of r.categories) {
      lines.push(`* *${c.heading}: ${c.people.length}*`);
      for (const p of c.people) {
        lines.push(p.note ? `- ${p.fullName}: ${p.note}` : `- ${p.fullName}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

/** The per-subunit table, for you and the secretary rather than the chat. */
export function formatSubunitBreakdown(r: AttendanceReport): string {
  const lines: string[] = ["*Subunit breakdown*"];
  for (const s of r.subunits) {
    if (s.noService) {
      lines.push(`- ${s.subunitName}: no service held`);
      continue;
    }
    if (!s.submitted) {
      lines.push(`- ${s.subunitName}: NOT SUBMITTED`);
      continue;
    }
    const pct = s.total > 0 ? Math.round((s.present / s.total) * 100) : 0;
    lines.push(
      `- ${s.subunitName}: ${s.present}/${s.total} present (${pct}%)${s.late ? " — submitted late" : ""}`
    );
  }
  return lines.join("\n");
}
