import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionRoles } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { ProfileForm } from "./profile-form";

export default async function ProfilePage() {
  const session = await getSessionRoles();
  if (!session) return null;
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, phone, whatsapp_number, location, birth_month, birth_day")
    .eq("id", session.userId)
    .single();

  // How many courses route their submissions to this person, so the page can
  // say plainly why the WhatsApp number matters to them specifically.
  const { data: instructorRows } = await admin.rpc("course_instructors");
  const myCourses = (instructorRows ?? []).filter((r) => r.instructor_id === session.userId);

  const { data: courseTitles } = myCourses.length
    ? await admin
        .from("courses")
        .select("id, title, is_published")
        .in(
          "id",
          myCourses.map((c) => c.course_id)
        )
    : { data: [] as { id: string; title: string; is_published: boolean }[] };

  return (
    <div>
      <PageHeader
        title="My profile"
        description="Your details. Keep your WhatsApp number current — it's how members reach you."
      />
      <ProfileForm
        email={profile?.email ?? ""}
        initial={{
          fullName: profile?.full_name ?? "",
          phone: profile?.phone ?? "",
          whatsappNumber: profile?.whatsapp_number ?? "",
          location: profile?.location ?? "",
          birthMonth: profile?.birth_month ? String(profile.birth_month) : "",
          birthDay: profile?.birth_day ? String(profile.birth_day) : "",
        }}
        instructorCourses={(courseTitles ?? []).map((c) => ({
          id: c.id,
          title: c.title,
          isPublished: c.is_published,
        }))}
      />
    </div>
  );
}
