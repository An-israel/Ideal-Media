import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ImportMembersForm } from "./import-members-form";

export default async function ImportMembersPage() {
  const supabase = await createClient();
  const { data: subunits } = await supabase
    .from("subunits")
    .select("id, name")
    .eq("category", "primary")
    .order("name");

  return (
    <div>
      <PageHeader
        title="Import members"
        description="Add your whole team at once from a spreadsheet."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <ImportMembersForm subunits={subunits ?? []} />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">How to prepare your file</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-[var(--text-muted)]">
            <p>
              Your columns don&apos;t need special names or tidying — the AI reads your
              sheet and figures out which column is the <b>name</b>, <b>email</b>,
              <b> phone</b>, <b>WhatsApp</b>, and <b>subunit</b>, and ignores the rest.
            </p>
            <p>Each row just needs, somewhere:</p>
            <ul className="space-y-1">
              <li>• a <b>name</b> (required)</li>
              <li>• a <b>phone / WhatsApp</b> number (recommended — links them at signup)</li>
              <li>• an <b>email</b> (optional — they add it when they sign up)</li>
            </ul>
            <p>
              If your sheet has no subunit column (e.g. it&apos;s one unit&apos;s list),
              pick a <b>default subunit</b> and it applies to everyone in the file.
              Everyone is created as an active member; they pick their own password when
              they sign up.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
