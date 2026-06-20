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
            <p>Use a .xlsx or .csv with a header row. These columns are read (others are ignored):</p>
            <ul className="space-y-1">
              <li>• <b>Full Name</b> — required</li>
              <li>• <b>Email</b> — required (their login)</li>
              <li>• <b>Phone</b> — optional</li>
              <li>• <b>WhatsApp</b> — recommended for leaders</li>
              <li>• <b>Primary Subunit</b> — required, must match a subunit name</li>
              <li>• <b>Secondary Subunits</b> — optional, comma-separated</li>
            </ul>
            <p>
              Everyone is created as an active member. They set their own password later
              with <b>“Forgot password”</b> on the login page, using their email. Rows
              that are missing info or already exist are skipped and listed for you.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
