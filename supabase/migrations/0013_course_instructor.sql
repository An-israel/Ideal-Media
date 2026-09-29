-- Ideal Media — name an instructor on every course, and make their WhatsApp
-- number the assignment-submission route.
--
-- Two problems this solves:
--   1. Nothing showed WHO a course belongs to. A member opening "Video Editing"
--      had no idea whose course it was.
--   2. The submit-to-WhatsApp link resolved a contact implicitly (course author
--      if they happened to lead the subunit, else the subunit's longest-standing
--      leader). A course outlives whoever first clicked "create", so the contact
--      needs to be an explicit, editable field.

-- ============================================================================
-- 1. courses.instructor_id
-- ============================================================================
alter table courses
  add column if not exists instructor_id uuid references profiles (id) on delete set null;

create index if not exists courses_instructor on courses (instructor_id);

-- Backfill: whoever created the course is its instructor until changed.
update courses set instructor_id = created_by where instructor_id is null;

comment on column courses.instructor_id is
  'The person who teaches this course and receives assignment submissions over WhatsApp. Defaults to created_by; editable by a leader of the course''s subunit.';

-- ============================================================================
-- 2. Expose instructor name + contact status to members
-- ============================================================================
-- A member cannot read their leader's profile row (profiles_select only grants
-- the reverse: leads_member lets a LEADER read a MEMBER). So showing "Video
-- Editing — Ada Okeke" on a course card needs a definer function that leaks
-- only the name and whether a WhatsApp number exists — never the number itself,
-- which stays server-side and is only ever used to build a wa.me link.
create or replace function public.course_instructors()
returns table (
  course_id uuid,
  instructor_id uuid,
  instructor_name text,
  has_whatsapp boolean
)
language sql stable security definer set search_path = public as $$
  select
    c.id,
    p.id,
    p.full_name,
    -- Mirrors lib/phone.ts: at least 8 digits once punctuation is stripped.
    (p.whatsapp_number is not null
      and length(regexp_replace(p.whatsapp_number, '\D', '', 'g')) >= 8) as has_whatsapp
  from courses c
  left join profiles p on p.id = coalesce(c.instructor_id, c.created_by)
  -- Scoped to courses the CALLER can already see. Without this, any member
  -- could enumerate every course id in the system and who teaches it,
  -- including other subunits' unpublished drafts. Because of this the function
  -- must be called on the user's own client, not the service-role client —
  -- course_visible() reads auth.uid().
  where public.course_visible(c.id);
$$;

-- ============================================================================
-- 3. Who still needs to add a WhatsApp number
-- ============================================================================
-- Deliberately NOT a SQL function. A definer function listing every instructor
-- with no contact details was reachable by any signed-in member: Supabase
-- grants EXECUTE on public-schema functions to `authenticated` by default, so
-- `revoke ... from public` did not hold. It is computed in
-- getInstructorsMissingWhatsApp() behind requireSuperAdmin() instead, which
-- also lets it reuse the tested normalizePhone() rather than a second,
-- divergent copy of the validity rule in SQL.
drop function if exists public.instructors_missing_whatsapp();
