import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowLeft, Target, Smartphone, Laptop } from "lucide-react";
import { getCourse } from "@/lib/academy";
import { hasDeviceSplit } from "@/lib/academy-content";
import { createAdminClient } from "@/lib/supabase/admin";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CourseBody } from "./course-body";

/** One course with this person's progress. Shared by /academy and /learn. */
export async function CourseView({
  slug,
  userId,
  basePath,
}: {
  slug: string;
  userId: string;
  basePath: string;
}) {
  const course = await getCourse(slug, userId);
  if (!course || !course.is_published) notFound();

  const admin = createAdminClient();
  const { data: certificate } = await admin
    .from("academy_certificates")
    .select("code, issued_at")
    .eq("user_id", userId)
    .eq("course_id", course.id)
    .maybeSingle();

  const steps = course.modules.reduce(
    (n, m) => n + m.lessons.length + (m.assignment ? 1 : 0),
    0
  );
  const doneSteps = course.modules.reduce(
    (n, m) => n + m.lessons.filter((l) => l.done).length + (m.submission ? 1 : 0),
    0
  );

  return (
    <div>
      <div className="mb-6">
        <Link href={basePath}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4" /> All courses
          </Button>
        </Link>
      </div>

      {course.cover_path && (
        <div className="relative mb-6 aspect-video w-full overflow-hidden rounded-xl bg-[var(--border)]">
          <Image
            src={course.cover_path}
            alt={course.title}
            fill
            sizes="(max-width: 1024px) 100vw, 1024px"
            className="object-cover"
            priority
          />
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge variant="neutral">{course.category}</Badge>
        <Badge variant="neutral">{course.level}</Badge>
        {course.weeks && <Badge variant="neutral">{course.weeks} weeks</Badge>}
        <Badge variant="neutral">
          {course.modules.length} modules · {course.lessonsTotal} lessons
        </Badge>
        {course.dual ? (
          <Badge variant="neutral">
            <Smartphone className="h-3 w-3" /> Phone or laptop
          </Badge>
        ) : (
          <Badge variant="neutral">
            <Laptop className="h-3 w-3" /> Laptop recommended
          </Badge>
        )}
      </div>

      <h1 className="text-2xl font-semibold tracking-tight">{course.title}</h1>
      {course.tagline && (
        <p className="mt-1 text-[var(--text-muted)]">{course.tagline}</p>
      )}
      {course.description && (
        <p className="mt-4 max-w-3xl text-sm leading-relaxed">{course.description}</p>
      )}

      {course.outcomes.length > 0 && (
        <Card className="mt-6">
          <CardHeader className="gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="h-4 w-4" /> What you will be able to do
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {course.outcomes.map((o) => (
                <li key={o} className="flex gap-2">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
                  {o}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {(course.tools.phone || course.tools.laptop) && (
        <Card className="mt-4">
          <CardContent className="grid gap-3 py-4 sm:grid-cols-2">
            {course.tools.phone && (
              <div>
                <p className="flex items-center gap-2 text-xs font-medium text-[var(--text-muted)]">
                  <Smartphone className="h-3.5 w-3.5" /> On your phone
                </p>
                <p className="mt-1 text-sm">{course.tools.phone}</p>
              </div>
            )}
            {course.tools.laptop && (
              <div>
                <p className="flex items-center gap-2 text-xs font-medium text-[var(--text-muted)]">
                  <Laptop className="h-3.5 w-3.5" /> On a laptop
                </p>
                <p className="mt-1 text-sm">{course.tools.laptop}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <CourseBody
        basePath={basePath}
        courseId={course.id}
        courseSlug={course.slug}
        courseTitle={course.title}
        hasDeviceSplit={hasDeviceSplit(course.modules)}
        modules={course.modules}
        steps={steps}
        doneSteps={doneSteps}
        complete={course.complete}
        certificate={certificate ?? null}
      />
    </div>
  );
}
