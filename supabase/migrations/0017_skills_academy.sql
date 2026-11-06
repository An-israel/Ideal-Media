-- ============================================================================
--  0017_skills_academy.sql — the Ideal Life City Media Skills Academy
-- ============================================================================
--  Twenty-two self-paced skill courses, open to every member, built from the
--  course documents the department supplied: 88 modules, 264 lessons, 487
--  YouTube videos and 88 assignments, ending in a certificate.
--
--  These are SEPARATE from the existing `courses` tables on purpose. Those are
--  a subunit's own training: owned by a subunit, applied for, approved by a
--  leader, with a leader marking work approved. The academy is the opposite in
--  every one of those respects — it belongs to no subunit, anyone may start
--  one the moment they see it, and progress is the member's own record. Sharing
--  one set of tables would have meant making `courses.subunit_id` nullable and
--  teaching every existing policy, query and page to handle a course with no
--  subunit, which is how a working feature gets broken by an unrelated one.
--
--  What IS shared is the shape of the thing: published-or-manager reads, and a
--  member who reads and writes only their own rows.
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'academy_assignment_kind') then
    -- 'self_check' is a checklist the member ticks; 'link' is a piece of work
    -- they link to. The documents use exactly these two.
    create type academy_assignment_kind as enum ('self_check', 'link');
  end if;
end $$;

-- ----------------------------------------------------------------------------
--  Content
-- ----------------------------------------------------------------------------
create table if not exists academy_courses (
  id uuid primary key default gen_random_uuid(),
  -- The slug is the identity: it is in the URL, it names the cover image, and
  -- it is what the importer upserts on, so re-importing updates a course
  -- instead of creating a second copy of it.
  slug text not null unique,
  position int not null default 1,
  title text not null,
  tagline text,
  description text,
  category text not null,
  level text not null,
  weeks int,
  -- True when the course teaches a skill you can practise on either device, so
  -- its practical lessons carry a phone video AND a laptop video. False when
  -- the skill needs a computer, and one video serves everybody.
  dual boolean not null default false,
  outcomes jsonb not null default '[]',
  tools jsonb not null default '{}',
  cover_path text,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists academy_courses_position on academy_courses (position);
create index if not exists academy_courses_category on academy_courses (category);

create table if not exists academy_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references academy_courses (id) on delete cascade,
  position int not null,
  title text not null,
  goal text,
  created_at timestamptz not null default now(),
  unique (course_id, position)
);
create index if not exists academy_modules_course on academy_modules (course_id);

create table if not exists academy_lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references academy_modules (id) on delete cascade,
  position int not null,
  title text not null,
  summary text,
  practical boolean not null default false,
  search_query text,
  -- { "any": [...] } or { "phone": [...], "laptop": [...] }, each entry
  -- { youtube_id, title, url }. The first in a list is the lesson's video and
  -- the rest are backups for when one is taken down — which is why they are
  -- kept rather than collapsed to a single id.
  videos jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (module_id, position)
);
create index if not exists academy_lessons_module on academy_lessons (module_id);

create table if not exists academy_assignments (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null unique references academy_modules (id) on delete cascade,
  kind academy_assignment_kind not null,
  title text not null,
  instructions text not null,
  checklist jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
--  A member's own record
--
--  There is deliberately no enrolment table. A member does not sign up for an
--  academy course, they just start it, and the first ticked lesson is the
--  start — a separate row saying so would only be a second thing to keep in
--  step with the progress rows.
-- ----------------------------------------------------------------------------
create table if not exists academy_lesson_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  lesson_id uuid not null references academy_lessons (id) on delete cascade,
  completed_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);
create index if not exists academy_lesson_progress_user on academy_lesson_progress (user_id);
create index if not exists academy_lesson_progress_lesson on academy_lesson_progress (lesson_id);

create table if not exists academy_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  assignment_id uuid not null references academy_assignments (id) on delete cascade,
  -- For a 'link' assignment: where the work is. For 'self_check': null.
  link text,
  -- For a 'self_check' assignment: the indexes of the checklist items ticked.
  checked jsonb not null default '[]',
  submitted_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (user_id, assignment_id)
);
create index if not exists academy_submissions_user on academy_submissions (user_id);
create index if not exists academy_submissions_assignment on academy_submissions (assignment_id);

create table if not exists academy_certificates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  course_id uuid not null references academy_courses (id) on delete cascade,
  -- Printed on the certificate so a claim can be checked against this table.
  code text not null unique,
  issued_at timestamptz not null default now(),
  unique (user_id, course_id)
);
create index if not exists academy_certificates_user on academy_certificates (user_id);

-- ----------------------------------------------------------------------------
--  Row level security
-- ----------------------------------------------------------------------------
alter table academy_courses          enable row level security;
alter table academy_modules          enable row level security;
alter table academy_lessons          enable row level security;
alter table academy_assignments      enable row level security;
alter table academy_lesson_progress  enable row level security;
alter table academy_submissions      enable row level security;
alter table academy_certificates     enable row level security;

-- Who may add or change academy content. The academy is department-wide, so it
-- is not a subunit leader's to edit.
create or replace function public.manages_academy()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or public.has_role('secretary');
$$;

comment on function public.manages_academy() is
  'True for the people who may import or edit Skills Academy content.';

-- Content: everyone signed in reads what is published; managers see drafts too.
drop policy if exists academy_courses_select on academy_courses;
create policy academy_courses_select on academy_courses for select using (
  is_published or public.manages_academy()
);
drop policy if exists academy_courses_write on academy_courses;
create policy academy_courses_write on academy_courses for all
  using (public.manages_academy()) with check (public.manages_academy());

-- A module, lesson or assignment is only as visible as its course. Without the
-- course check, an unpublished course's modules would still be readable.
drop policy if exists academy_modules_select on academy_modules;
create policy academy_modules_select on academy_modules for select using (
  exists (
    select 1 from academy_courses c
    where c.id = course_id and (c.is_published or public.manages_academy())
  )
);
drop policy if exists academy_modules_write on academy_modules;
create policy academy_modules_write on academy_modules for all
  using (public.manages_academy()) with check (public.manages_academy());

drop policy if exists academy_lessons_select on academy_lessons;
create policy academy_lessons_select on academy_lessons for select using (
  exists (
    select 1 from academy_modules m
    join academy_courses c on c.id = m.course_id
    where m.id = module_id and (c.is_published or public.manages_academy())
  )
);
drop policy if exists academy_lessons_write on academy_lessons;
create policy academy_lessons_write on academy_lessons for all
  using (public.manages_academy()) with check (public.manages_academy());

drop policy if exists academy_assignments_select on academy_assignments;
create policy academy_assignments_select on academy_assignments for select using (
  exists (
    select 1 from academy_modules m
    join academy_courses c on c.id = m.course_id
    where m.id = module_id and (c.is_published or public.manages_academy())
  )
);
drop policy if exists academy_assignments_write on academy_assignments;
create policy academy_assignments_write on academy_assignments for all
  using (public.manages_academy()) with check (public.manages_academy());

-- A member's own record. access_active() keeps a revoked member out even on a
-- session issued before the revocation, the same way attendance does it.
drop policy if exists academy_lesson_progress_select on academy_lesson_progress;
create policy academy_lesson_progress_select on academy_lesson_progress for select using (
  (user_id = auth.uid() and public.access_active())
  or public.manages_academy()
  or public.leads_member(user_id)
);
drop policy if exists academy_lesson_progress_insert on academy_lesson_progress;
create policy academy_lesson_progress_insert on academy_lesson_progress for insert with check (
  user_id = auth.uid() and public.access_active()
);
drop policy if exists academy_lesson_progress_delete on academy_lesson_progress;
create policy academy_lesson_progress_delete on academy_lesson_progress for delete
  using (user_id = auth.uid() and public.access_active());

drop policy if exists academy_submissions_select on academy_submissions;
create policy academy_submissions_select on academy_submissions for select using (
  (user_id = auth.uid() and public.access_active())
  or public.manages_academy()
  or public.leads_member(user_id)
);
drop policy if exists academy_submissions_insert on academy_submissions;
create policy academy_submissions_insert on academy_submissions for insert with check (
  user_id = auth.uid() and public.access_active()
);
drop policy if exists academy_submissions_update on academy_submissions;
create policy academy_submissions_update on academy_submissions for update
  using (user_id = auth.uid() and public.access_active())
  with check (user_id = auth.uid() and public.access_active());

-- A certificate is evidence, so a member may read theirs but never write one:
-- it is issued server-side once every module of the course is done.
drop policy if exists academy_certificates_select on academy_certificates;
create policy academy_certificates_select on academy_certificates for select using (
  (user_id = auth.uid() and public.access_active())
  or public.manages_academy()
  or public.leads_member(user_id)
);
drop policy if exists academy_certificates_write on academy_certificates;
create policy academy_certificates_write on academy_certificates for all
  using (public.manages_academy()) with check (public.manages_academy());

-- ----------------------------------------------------------------------------
--  Completion, in one place
-- ----------------------------------------------------------------------------
-- A module is done when every lesson in it is marked done AND its assignment
-- has been submitted. A course is done when every module is. Both the course
-- page and the certificate need that answer, and two copies of this rule would
-- eventually disagree about who has finished.
create or replace function public.academy_course_complete(c_id uuid, u_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from academy_modules m where m.course_id = c_id)
    and not exists (
      select 1
      from academy_modules m
      left join academy_lessons l on l.module_id = m.id
      left join academy_lesson_progress lp
        on lp.lesson_id = l.id and lp.user_id = u_id
      where m.course_id = c_id and l.id is not null and lp.id is null
    )
    and not exists (
      select 1
      from academy_modules m
      join academy_assignments a on a.module_id = m.id
      left join academy_submissions s
        on s.assignment_id = a.id and s.user_id = u_id
      where m.course_id = c_id and s.id is null
    );
$$;

comment on function public.academy_course_complete(uuid, uuid) is
  'True when the member has marked every lesson done and submitted every assignment in the course.';

select 'Skills Academy tables created. Import the courses from Admin -> Skills Academy.' as next_step;
