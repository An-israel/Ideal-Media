import { getSessionRoles } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { CertificateView } from "@/components/academy/certificate-view";

export default async function CertificatePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await getSessionRoles();
  if (!session) return null;

  const { slug } = await params;
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", session.userId)
    .maybeSingle();

  return (
    <CertificateView
      slug={slug}
      userId={session.userId}
      fullName={profile?.full_name ?? "Member"}
      basePath="/academy"
    />
  );
}
