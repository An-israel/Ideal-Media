import { redirect } from "next/navigation";
import { getAcademyUser } from "@/lib/academy-user";
import { CourseView } from "@/components/academy/course-view";

export default async function LearnCoursePage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getAcademyUser();
  if (!user) redirect("/login");
  const { slug } = await params;
  return <CourseView slug={slug} userId={user.userId} basePath="/learn" />;
}
