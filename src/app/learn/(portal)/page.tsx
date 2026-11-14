import { redirect } from "next/navigation";
import { getAcademyUser } from "@/lib/academy-user";
import { AcademyIndex } from "@/components/academy/academy-index";

export const metadata = { title: "Skills Academy — Ideal Media" };

export default async function LearnHome({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const user = await getAcademyUser();
  if (!user) redirect("/login");
  const { category } = await searchParams;

  return (
    <AcademyIndex
      userId={user.userId}
      basePath="/learn"
      category={category}
      audience="everyone"
      emptyHint="Check back soon."
    />
  );
}
