import { redirect } from "next/navigation";
import { getAcademyUser } from "@/lib/academy-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/app/page-header";
import { AccountForm } from "./account-form";

export default async function LearnAccountPage() {
  const user = await getAcademyUser();
  if (!user || user.kind !== "learner") redirect("/login");

  const admin = createAdminClient();
  const { data: learner } = await admin
    .from("learners")
    .select("full_name, email, phone, created_at")
    .eq("id", user.userId)
    .maybeSingle();
  if (!learner) redirect("/login");

  return (
    <div className="max-w-lg">
      <PageHeader title="My account" description={`Signed in as ${learner.email}`} />
      <AccountForm fullName={learner.full_name} phone={learner.phone ?? ""} />
    </div>
  );
}
