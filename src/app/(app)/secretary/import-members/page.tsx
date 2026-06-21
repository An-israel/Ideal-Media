import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ImportMembersForm } from "./import-members-form";

export default function ImportMembersPage() {
  return (
    <div>
      <PageHeader
        title="Import members"
        description="Add your whole team at once from a spreadsheet."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <ImportMembersForm />
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
            <p>Just make sure the sheet contains, somewhere:</p>
            <ul className="space-y-1">
              <li>• each person&apos;s <b>name</b> and <b>email</b> (required)</li>
              <li>• a <b>phone / WhatsApp</b> number (recommended — used to link them at signup)</li>
              <li>• their <b>subunit / unit</b> (matched loosely, e.g. “Photo” → Photography)</li>
            </ul>
            <p>
              Everyone is created as an active member; they pick their own password when
              they sign up. Rows missing a name/email, with an unrecognized subunit, or
              already in the system are skipped and listed for you.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
