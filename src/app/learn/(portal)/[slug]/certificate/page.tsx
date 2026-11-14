import { redirect } from "next/navigation";
import { getAcademyUser } from "@/lib/academy-user";
import { CertificateView } from "@/components/academy/certificate-view";

export default async function LearnCertificatePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const user = await getAcademyUser();
  if (!user) redirect("/login");
  const { slug } = await params;
  return (
    <CertificateView slug={slug} userId={user.userId} fullName={user.fullName} basePath="/learn" />
  );
}
