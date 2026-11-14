-- ============================================================================
--  0020_course_learners.sql — people who join only for the Skills Academy
-- ============================================================================
--  The academy is now open to people outside the media department. They must
--  never become part of the department's own records: the members list, the
--  roster, attendance, welfare follow-ups, subunits and every report the
--  secretary and welfare team rely on.
--
--  So a course-only learner gets NO profile. Every one of those records is
--  keyed on profiles — by foreign key, not just by convention — which means a
--  learner cannot be added to a subunit, marked present or absent, opened a
--  welfare case for, or given a role, because the database has nothing to
--  attach it to. The separation is a property of the schema rather than a
--  rule every page has to remember.
--
--  What learners do share with members is the academy's own progress tables.
--  Those pointed at profiles, so they are re-pointed at the login itself
--  (auth.users). Every member's profile id IS their login id, so every
--  existing row stays valid and nothing about a member's progress changes.
--
--  Safe to run more than once.
-- ============================================================================

create table if not exists learners (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  -- Set by an admin to stop someone using the academy. Their progress and
  -- certificates are kept, but certificates stop verifying while suspended.
  suspended_at timestamptz,
  suspended_reason text
);
create index if not exists learners_email on learners (lower(email));

comment on table learners is
  'Course-only Skills Academy accounts. Deliberately not profiles, so learners never appear in the media department''s roster, attendance, welfare or reports.';

alter table learners enable row level security;

-- A learner reads their own row; the people who run the academy read all.
-- Every write goes through the server, so there are no write policies.
drop policy if exists learners_select on learners;
create policy learners_select on learners for select using (
  id = auth.uid() or public.manages_academy()
);

-- ----------------------------------------------------------------------------
--  Academy progress belongs to a login, member or learner
-- ----------------------------------------------------------------------------
alter table academy_lesson_progress drop constraint if exists academy_lesson_progress_user_id_fkey;
alter table academy_lesson_progress
  add constraint academy_lesson_progress_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

alter table academy_submissions drop constraint if exists academy_submissions_user_id_fkey;
alter table academy_submissions
  add constraint academy_submissions_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

alter table academy_certificates drop constraint if exists academy_certificates_user_id_fkey;
alter table academy_certificates
  add constraint academy_certificates_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

-- ----------------------------------------------------------------------------
--  Who may use the academy right now
-- ----------------------------------------------------------------------------
-- access_active() answers this for members (a profile whose access has not
-- been removed). A learner has no profile, so on its own it would lock every
-- learner out of their own progress.
create or replace function public.academy_access_ok()
returns boolean language sql stable security definer set search_path = public as $$
  select public.access_active()
      or exists (
        select 1 from learners l where l.id = auth.uid() and l.suspended_at is null
      );
$$;

comment on function public.academy_access_ok() is
  'True for a member whose access is active, or a course-only learner who is not suspended.';

drop policy if exists academy_lesson_progress_select on academy_lesson_progress;
create policy academy_lesson_progress_select on academy_lesson_progress for select using (
  (user_id = auth.uid() and public.academy_access_ok())
  or public.manages_academy()
  or public.leads_member(user_id)
);
drop policy if exists academy_lesson_progress_insert on academy_lesson_progress;
create policy academy_lesson_progress_insert on academy_lesson_progress for insert with check (
  user_id = auth.uid() and public.academy_access_ok()
);
drop policy if exists academy_lesson_progress_delete on academy_lesson_progress;
create policy academy_lesson_progress_delete on academy_lesson_progress for delete
  using (user_id = auth.uid() and public.academy_access_ok());

drop policy if exists academy_submissions_select on academy_submissions;
create policy academy_submissions_select on academy_submissions for select using (
  (user_id = auth.uid() and public.academy_access_ok())
  or public.manages_academy()
  or public.leads_member(user_id)
);
drop policy if exists academy_submissions_insert on academy_submissions;
create policy academy_submissions_insert on academy_submissions for insert with check (
  user_id = auth.uid() and public.academy_access_ok()
);
drop policy if exists academy_submissions_update on academy_submissions;
create policy academy_submissions_update on academy_submissions for update
  using (user_id = auth.uid() and public.academy_access_ok())
  with check (user_id = auth.uid() and public.academy_access_ok());

drop policy if exists academy_certificates_select on academy_certificates;
create policy academy_certificates_select on academy_certificates for select using (
  (user_id = auth.uid() and public.academy_access_ok())
  or public.manages_academy()
  or public.leads_member(user_id)
);

select 'Course-only learners ready. They sign up at /learn/signup.' as result;
