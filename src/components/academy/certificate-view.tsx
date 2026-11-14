import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { Button } from "@/components/ui/button";
import { PrintButton } from "./print-button";

/**
 * The certificate itself, laid out to be printed or saved as a PDF from the
 * browser rather than generated server-side — one page, no new dependency, and
 * the learner gets the same result on a phone.
 *
 * The name is passed in rather than read here, because a department member's
 * name lives on their profile and a course-only learner's does not.
 */
export async function CertificateView({
  slug,
  userId,
  fullName,
  basePath,
}: {
  slug: string;
  userId: string;
  fullName: string;
  basePath: string;
}) {
  const admin = createAdminClient();

  const { data: course } = await admin
    .from("academy_courses")
    .select("id, title, level, weeks")
    .eq("slug", slug)
    .maybeSingle();
  if (!course) notFound();

  const { data: certificate } = await admin
    .from("academy_certificates")
    .select("code, issued_at")
    .eq("user_id", userId)
    .eq("course_id", course.id)
    .maybeSingle();
  // No certificate means it has not been earned. There is nothing to show, and
  // a placeholder would be a certificate that says nothing was achieved.
  if (!certificate) notFound();

  // Printed on the certificate, so that the paper copy says where to check it.
  const h = await headers();
  const verifyHost = (
    process.env.NEXT_PUBLIC_APP_URL || `https://${h.get("host") ?? "ideal-media.vercel.app"}`
  ).replace(/^https?:\/\//, "").replace(/\/$/, "");

  const issued = new Date(certificate.issued_at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-2 print:hidden">
        <Link href={`${basePath}/${slug}`}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4" /> Back to the course
          </Button>
        </Link>
        <PrintButton />
      </div>

      <div className="mx-auto max-w-3xl rounded-xl border-4 border-double border-[var(--accent)] bg-[var(--surface)] p-8 text-center sm:p-14 print:border-black print:bg-white print:text-black">
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--text-muted)] print:text-black">
          Ideal Life City Media
        </p>
        <p className="mt-1 text-xs uppercase tracking-[0.3em] text-[var(--text-muted)] print:text-black">
          Skills Academy
        </p>

        <h1 className="mt-10 text-sm uppercase tracking-[0.2em] text-[var(--text-muted)] print:text-black">
          Certificate of Completion
        </h1>

        <p className="mt-8 text-sm text-[var(--text-muted)] print:text-black">
          This is to certify that
        </p>
        <p className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          {fullName}
        </p>

        <p className="mt-8 text-sm text-[var(--text-muted)] print:text-black">
          has completed every module and assignment of
        </p>
        <p className="mt-2 text-xl font-medium sm:text-2xl">{course.title}</p>
        <p className="mt-1 text-sm text-[var(--text-muted)] print:text-black">
          {course.level}
          {course.weeks ? ` · ${course.weeks}-week course` : ""}
        </p>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-[var(--border)] pt-6 text-xs text-[var(--text-muted)] sm:flex-row print:border-black print:text-black">
          <span>Issued {issued}</span>
          <span className="font-mono">{certificate.code}</span>
        </div>
        <p className="mt-3 text-[10px] text-[var(--text-muted)] print:text-black">
          Verify this certificate at {verifyHost}/verify
        </p>
      </div>

      <p className="mx-auto mt-4 max-w-3xl text-center text-xs text-[var(--text-muted)] print:hidden">
        Anyone can confirm this certificate by entering its number at{" "}
        <Link href={`/verify?code=${certificate.code}`} className="underline">
          the certificate check page
        </Link>
        .
      </p>
    </div>
  );
}
