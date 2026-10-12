-- Ideal Media — revoking a member's access without destroying their history.
--
-- The department reconciles the site against its official members list, and
-- anyone no longer with the unit must lose access. Deleting the account was the
-- obvious reading of "remove them", but profiles.id cascades into ten tables —
-- attendance records, subunit memberships, enrolments, assignment progress,
-- training progress, welfare follow-ups, notifications. Deleting one person
-- therefore rewrites history: a report for a past service would lose them, and
-- its totals would silently change after the numbers had already been sent to
-- the Pastors.
--
-- So access is revoked instead. The person cannot sign in and is off every
-- roster, list and future report, while what they did stays recorded. It is
-- also reversible, which matters when the thing driving it is a name match.

alter table profiles
  add column if not exists access_revoked_at timestamptz,
  add column if not exists access_revoked_by uuid references profiles (id) on delete set null,
  add column if not exists access_revoked_reason text;

comment on column profiles.access_revoked_at is
  'Set when the member is no longer part of the unit. They cannot sign in, and are excluded from every roster and future report, but their history is kept. Null means active access.';

create index if not exists profiles_access_revoked on profiles (access_revoked_at)
  where access_revoked_at is not null;

-- ============================================================================
-- Keep revoked members out of the roll
-- ============================================================================
-- "Total Members" counts people still on the roll. Revoked members are off it,
-- the same as graduated and left.
create or replace function public.attendance_roll_total()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from profiles
  where member_status not in ('graduated', 'left')
    and access_revoked_at is null;
$$;

-- ============================================================================
-- A revoked member cannot read anything through RLS either
-- ============================================================================
-- Revocation is enforced in the app (the layout signs them out) and at the auth
-- layer (the Supabase user is banned). This is the third lock: even holding a
-- valid session, a revoked member's own policies stop matching, so the data
-- does not come back.
create or replace function public.access_active()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.access_revoked_at is null
  );
$$;

comment on function public.access_active() is
  'False once a member''s access is revoked. Used by policies that let a member read their own data, so revocation holds even on a session issued before it.';

-- A revoked member must not keep reading their own records.
drop policy if exists attendance_records_select on attendance_records;
create policy attendance_records_select on attendance_records for select using (
  public.is_super_admin()
  or public.has_role('secretary')
  or public.has_role('welfare')
  or public.leads_member(user_id)
  or (user_id = auth.uid() and public.access_active())
);
