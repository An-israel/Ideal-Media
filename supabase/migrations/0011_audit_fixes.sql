-- Ideal Media — audit remediation (see AUDIT.md).
--
-- Fixes, in order:
--   1. RLS privilege escalation: self-granted leadership, self-approval of
--      assignments, self-enrollment (SEC-1, SEC-2, SEC-3).
--   2. Deletable members: FK columns referencing profiles had no ON DELETE,
--      which blocked every delete (ROS-1 / DATA-1).
--   3. Server-side COC quiz integrity (SEC-4).
--   4. COC re-acceptance on a new version, published atomically (AUTH-3, ADM-3).
--   5. Missing uniqueness that let silent duplicates through (DATA-2, ROS-7).
--   6. Indexes matching the queries that actually run (PERF-6).
--   7. The 4-subunit cap, enforced in the DB instead of in four code paths (ROS-5).
--   8. updated_at tracking (DATA-3).

-- ============================================================================
-- 1. RLS — close the three privilege-escalation holes
-- ============================================================================

-- SEC-1: a member could insert themselves as role_in_subunit='leader' into any
-- subunit, which made leads_subunit() true and unlocked every leader-scoped
-- policy. Self-inserts are now always plain members; only a super admin (or the
-- service-role client, which bypasses RLS) can create a leader.
drop policy if exists subunit_members_insert_self on subunit_members;
create policy subunit_members_insert_self on subunit_members for insert with check (
  (user_id = auth.uid() and role_in_subunit = 'member')
  or public.is_super_admin()
);

-- SEC-2: module_progress_update allowed user_id = auth.uid() so a member could
-- set their own row to 'approved'. USING still lets them touch their own row
-- (needed to mark a module in progress / submitted), but WITH CHECK now forbids
-- a member writing an approval. Leaders and super admins are unaffected.
drop policy if exists module_progress_update on module_progress;
create policy module_progress_update on module_progress for update using (
  user_id = auth.uid()
  or public.is_super_admin()
  or public.leads_subunit(public.course_subunit((select course_id from modules where id = module_progress.module_id)))
) with check (
  public.is_super_admin()
  or public.leads_subunit(public.course_subunit((select course_id from modules where id = module_progress.module_id)))
  or (
    user_id = auth.uid()
    and status <> 'approved'
    and approved_by is null
    and approved_at is null
  )
);

-- SEC-3: enrollments_insert_self put no constraint on `status`, so a member
-- could insert themselves as 'enrolled' and skip the application + approval
-- flow. Self-inserts are now applications only. Auto-enrollment runs on the
-- service-role client and is unaffected.
drop policy if exists enrollments_insert_self on enrollments;
create policy enrollments_insert_self on enrollments for insert with check (
  public.is_super_admin()
  or (
    user_id = auth.uid()
    and status = 'pending_application'
    and decided_by is null
    and decided_at is null
  )
);

-- ============================================================================
-- 2. Make members deletable — add ON DELETE to every profiles reference
-- ============================================================================
-- These five columns referenced profiles(id) with no ON DELETE clause, so they
-- defaulted to NO ACTION and raised a foreign-key violation on any attempt to
-- delete a member who had ever uploaded a sheet, created a course, approved a
-- module, decided an application, or been assigned a follow-up.
--
-- Two of them were NOT NULL, so they are relaxed first: we want to keep the
-- course/upload and forget who made it, not cascade-delete the record.

alter table attendance_uploads alter column uploaded_by drop not null;
alter table attendance_uploads drop constraint if exists attendance_uploads_uploaded_by_fkey;
alter table attendance_uploads
  add constraint attendance_uploads_uploaded_by_fkey
  foreign key (uploaded_by) references profiles (id) on delete set null;

alter table courses alter column created_by drop not null;
alter table courses drop constraint if exists courses_created_by_fkey;
alter table courses
  add constraint courses_created_by_fkey
  foreign key (created_by) references profiles (id) on delete set null;

alter table module_progress drop constraint if exists module_progress_approved_by_fkey;
alter table module_progress
  add constraint module_progress_approved_by_fkey
  foreign key (approved_by) references profiles (id) on delete set null;

alter table enrollments drop constraint if exists enrollments_decided_by_fkey;
alter table enrollments
  add constraint enrollments_decided_by_fkey
  foreign key (decided_by) references profiles (id) on delete set null;

alter table welfare_followups drop constraint if exists welfare_followups_assigned_to_fkey;
alter table welfare_followups
  add constraint welfare_followups_assigned_to_fkey
  foreign key (assigned_to) references profiles (id) on delete set null;

-- courses_insert required created_by = auth.uid(); now that the column is
-- nullable the policy needs to keep rejecting a NULL author on insert.
drop policy if exists courses_insert on courses;
create policy courses_insert on courses for insert with check (
  public.is_super_admin()
  or (public.leads_subunit(subunit_id) and created_by = auth.uid())
);

-- ============================================================================
-- 3. COC quiz integrity (SEC-4)
-- ============================================================================
-- The quiz was graded against whatever array the client sent, with the total
-- derived from it — so a single correct answer passed. The server now records
-- which questions it issued, and grading is only valid against an unconsumed
-- issue for that user.
create table if not exists public.coc_quiz_issues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  question_ids uuid[] not null,
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists coc_quiz_issues_user on public.coc_quiz_issues (user_id, consumed);

alter table public.coc_quiz_issues enable row level security;
-- No policies beyond super admin: this table is only ever touched by the
-- service-role client inside the grading action.
drop policy if exists coc_quiz_issues_admin on public.coc_quiz_issues;
create policy coc_quiz_issues_admin on public.coc_quiz_issues for all
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ============================================================================
-- 4. COC versioning that actually requires re-acceptance (AUTH-3, ADM-3)
-- ============================================================================
alter table public.coc_attempts add column if not exists coc_version int;
alter table public.profiles add column if not exists coc_version_accepted int;

-- Backfill: anyone already through the gate accepted whatever is active now.
update public.profiles p
set coc_version_accepted = (select version from public.code_of_conduct where is_active limit 1)
where p.coc_completed and p.coc_version_accepted is null;

-- Publishing was two un-transacted statements against the one_active_coc
-- partial unique index: if the insert failed, NO version was left active and
-- the COC gate broke for everyone. This does it atomically, and resets the
-- gate so a revised code of conduct is genuinely re-read and re-accepted.
create or replace function public.publish_coc_version(p_title text, p_body text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_next int;
begin
  if not public.is_super_admin() then
    raise exception 'super admin required';
  end if;

  select coalesce(max(version), 0) + 1 into v_next from code_of_conduct;

  update code_of_conduct set is_active = false where is_active;
  insert into code_of_conduct (version, title, body, is_active)
    values (v_next, p_title, p_body, true);

  -- Everyone must read and accept the new version.
  update profiles
    set coc_completed = false, coc_completed_at = null, coc_version_accepted = null
    where coc_completed;

  -- Any quiz issued against the old version is void.
  update coc_quiz_issues set consumed = true where not consumed;

  return v_next;
end;
$$;

-- ============================================================================
-- 5. Uniqueness that was only ever enforced in application code
-- ============================================================================
-- DATA-2: profiles.email had no unique constraint, so the duplicate pre-checks
-- in signup / import / welfare were the only guard — and those read a query
-- capped at 1000 rows. Guarded so the migration reports duplicates rather than
-- failing outright.
do $$
declare
  dupes int;
begin
  select count(*) into dupes from (
    select lower(email) from profiles group by lower(email) having count(*) > 1
  ) d;
  if dupes > 0 then
    raise warning 'profiles: % duplicate email(s) — resolve them, then create profiles_email_unique manually', dupes;
  else
    create unique index if not exists profiles_email_unique on profiles (lower(email));
  end if;
end $$;

-- ROS-7: the seed used `on conflict do nothing` on tables with no unique key,
-- so re-running it silently duplicated every activity and question.
do $$
declare
  dupes int;
begin
  select count(*) into dupes from (
    select lower(name) from activities group by lower(name) having count(*) > 1
  ) d;
  if dupes > 0 then
    raise warning 'activities: % duplicate name(s) — resolve, then create activities_name_unique manually', dupes;
  else
    create unique index if not exists activities_name_unique on activities (lower(name));
  end if;
end $$;

do $$
declare
  dupes int;
begin
  select count(*) into dupes from (
    select lower(question) from coc_questions group by lower(question) having count(*) > 1
  ) d;
  if dupes > 0 then
    raise warning 'coc_questions: % duplicate question(s) — resolve, then create coc_questions_unique manually', dupes;
  else
    create unique index if not exists coc_questions_unique on coc_questions (lower(question));
  end if;
end $$;

-- ============================================================================
-- 6. Indexes matching the queries that actually run (PERF-6)
-- ============================================================================
-- getMemberPerformance filters user_id + service_date >= window.
create index if not exists attendance_records_user_date
  on attendance_records (user_id, service_date desc);

-- syncWelfareForStatus / recomputeMissedService filter reason + status + user.
create index if not exists welfare_followups_reason_status_user
  on welfare_followups (reason, status, user_id);

-- Approval queues and progress rollups filter on status.
create index if not exists module_progress_user_status
  on module_progress (user_id, status);
create index if not exists enrollments_status on enrollments (status);

-- Admin analytics reads the newest service dates first.
create index if not exists attendance_records_date_desc
  on attendance_records (service_date desc);

-- ============================================================================
-- 7. The 4-subunit cap, enforced once in the DB (ROS-5)
-- ============================================================================
-- The cap was a hardcoded `4` in four separate code paths, none of which could
-- stop a concurrent insert from exceeding it.
create or replace function public.enforce_subunit_cap()
returns trigger language plpgsql as $$
declare
  n int;
begin
  select count(*) into n from subunit_members where user_id = new.user_id;
  if n >= 4 then
    raise exception 'A member can belong to at most 4 subunits';
  end if;
  return new;
end;
$$;

drop trigger if exists subunit_members_cap on subunit_members;
create trigger subunit_members_cap
  before insert on subunit_members
  for each row execute function public.enforce_subunit_cap();

-- ============================================================================
-- 8. updated_at tracking (DATA-3)
-- ============================================================================
alter table profiles          add column if not exists updated_at timestamptz;
alter table welfare_followups add column if not exists updated_at timestamptz;
alter table courses           add column if not exists updated_at timestamptz;
alter table modules           add column if not exists updated_at timestamptz;
alter table module_progress   add column if not exists updated_at timestamptz;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['profiles','welfare_followups','courses','modules','module_progress'] loop
    execute format('drop trigger if exists touch_%1$s on %1$s', t);
    execute format(
      'create trigger touch_%1$s before update on %1$s for each row execute function public.touch_updated_at()', t
    );
  end loop;
end $$;

-- ============================================================================
-- 9. Surface why a parse failed (AUDIT ATT-2)
-- ============================================================================
-- The upload action caught every parse error with a bare `catch {}` and fell
-- back to an empty proposal, so a missing API key, a rate limit and a genuinely
-- unreadable sheet all looked identical to the secretary. Store the reason.
alter table attendance_uploads add column if not exists parse_error text;

-- ============================================================================
-- 10. Atomic module reorder (AUDIT CRS-2)
-- ============================================================================
-- Reordering was three sequential un-transacted UPDATEs using position = -1 as
-- a temporary. If the second or third failed, a module was stranded at -1 —
-- which sorts ahead of module 1 and then blocks every later reorder on the
-- unique (course_id, position) constraint. A function body is one transaction,
-- so the swap now either completes or doesn't happen.
create or replace function public.move_module(p_module_id uuid, p_direction text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_course uuid;
  v_pos int;
  v_other_id uuid;
  v_other_pos int;
begin
  select course_id, position into v_course, v_pos from modules where id = p_module_id;
  if v_course is null then
    raise exception 'Module not found';
  end if;

  if not (public.is_super_admin() or public.leads_subunit(public.course_subunit(v_course))) then
    raise exception 'Not allowed for this course';
  end if;

  if p_direction = 'up' then
    select id, position into v_other_id, v_other_pos
    from modules
    where course_id = v_course and position < v_pos
    order by position desc
    limit 1;
  elsif p_direction = 'down' then
    select id, position into v_other_id, v_other_pos
    from modules
    where course_id = v_course and position > v_pos
    order by position asc
    limit 1;
  else
    raise exception 'direction must be up or down';
  end if;

  -- Already at the end in that direction.
  if v_other_id is null then
    return;
  end if;

  update modules set position = -1 where id = p_module_id;
  update modules set position = v_pos where id = v_other_id;
  update modules set position = v_other_pos where id = p_module_id;
end;
$$;

-- Repair any module already stranded at a negative position by an interrupted
-- reorder, putting it back at the end of its course.
with stranded as (
  select m.id, m.course_id,
         (select coalesce(max(position), 0) from modules m2
          where m2.course_id = m.course_id and m2.position > 0) as max_pos,
         row_number() over (partition by m.course_id order by m.created_at) as rn
  from modules m
  where m.position < 1
)
update modules set position = stranded.max_pos + stranded.rn
from stranded
where modules.id = stranded.id;

-- ============================================================================
-- 11. A real assignment-rejection history (AUDIT CRS-6)
-- ============================================================================
-- The assignment approval rate was derived from `rejection_note`, which is
-- cleared on approval — so a member rejected three times and then approved
-- scored a perfect 100%. The metric only ever reflected CURRENTLY outstanding
-- rejections, not the actual history, and nothing recorded the real count.
alter table module_progress add column if not exists rejection_count int not null default 0;

-- Backfill: an outstanding rejection note is evidence of at least one.
update module_progress
set rejection_count = 1
where rejection_count = 0 and rejection_note is not null and status <> 'approved';

-- ============================================================================
-- 12. Clarify the notifications insert policy (AUDIT SEC-10)
-- ============================================================================
-- Every real insert comes from lib/notify.ts on the service-role client, which
-- bypasses RLS. The policy read as though super admins create notifications,
-- which is not how the app works. Keep the deny-by-default posture but drop the
-- misleading super-admin grant: nothing legitimate uses it.
drop policy if exists notifications_insert on notifications;
comment on table notifications is
  'Inserts come exclusively from the server via the service-role client (lib/notify.ts). No INSERT policy exists, so RLS denies inserts from any signed-in client by design.';
