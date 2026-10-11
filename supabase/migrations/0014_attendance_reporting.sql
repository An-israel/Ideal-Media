-- Ideal Media — structured weekly attendance reporting.
--
-- Replaces the WhatsApp ritual: leaders (or welfare/secretary) record who was
-- present for Sunday Service and Bible Study, absences carry a category and a
-- note, and the department report is generated from the data rather than typed
-- out by hand each week.
--
-- Everything writes into the EXISTING attendance_records table, so the new
-- submissions feed the welfare missed-service automation, the monthly totals
-- and the secretary grid. One set of numbers, not two.

-- ============================================================================
-- 1. Absence categories
-- ============================================================================
-- Taken verbatim from the department's own report headings, so a generated
-- report reads the way the handwritten one always has.
do $$ begin
  create type absence_reason as enum (
    'illness',
    'travelled',
    'academic',
    'on_it',
    'unreachable',
    'not_responding',
    'no_valid_reason',
    'other',
    'withdrawn',
    'inconsistent'
  );
exception when duplicate_object then null; end $$;

-- Two new provenances alongside 'sheet_upload' and 'manual'.
do $$ begin
  alter type attendance_source add value if not exists 'leader_submission';
exception when undefined_object then null; end $$;
do $$ begin
  alter type attendance_source add value if not exists 'absentee_paste';
exception when undefined_object then null; end $$;

-- ============================================================================
-- 2. Absence detail on the attendance record
-- ============================================================================
alter table attendance_records
  add column if not exists absence_reason absence_reason,
  add column if not exists absence_note text,
  add column if not exists recorded_by uuid references profiles (id) on delete set null,
  add column if not exists recorded_at timestamptz not null default now();

comment on column attendance_records.absence_reason is
  'Which heading this person falls under in the absentee report. Null when present.';
comment on column attendance_records.absence_note is
  'The free-text detail that follows the name in the report ("travelled to Enugu, back before Wednesday").';

-- A reason only makes sense on a non-present record. Guards against a present
-- row carrying a stale "travelled" from a previous week's correction.
do $$ begin
  alter table attendance_records
    add constraint reason_only_when_away
    check (status = 'present' and absence_reason is null or status <> 'present');
exception when duplicate_object then null; end $$;

create index if not exists attendance_records_reason
  on attendance_records (activity_id, service_date, absence_reason);

-- ============================================================================
-- 3. One submission per subunit per service
-- ============================================================================
-- Tracks WHO reported, WHEN, whether it beat the deadline, and whether the
-- subunit met at all that week — so "nobody submitted" is distinguishable from
-- "there was no service", which a bare absence of attendance rows is not.
create table if not exists attendance_submissions (
  id uuid primary key default gen_random_uuid(),
  subunit_id uuid not null references subunits (id) on delete cascade,
  activity_id uuid not null references activities (id) on delete cascade,
  service_date date not null,
  submitted_by uuid references profiles (id) on delete set null,
  submitted_at timestamptz not null default now(),
  /* Stamped at submission time against the Mon/Thu 20:00 WAT deadline. */
  is_late boolean not null default false,
  /* Public holiday, camp, church programme — closes the week without marking
     anybody absent and without counting as a missed report. */
  no_service boolean not null default false,
  no_service_reason text,
  present_count int not null default 0,
  absent_count int not null default 0,
  /* Set when secretary/welfare/super admin amend a leader's submission. */
  amended_by uuid references profiles (id) on delete set null,
  amended_at timestamptz,
  created_at timestamptz not null default now(),
  unique (subunit_id, activity_id, service_date)
);
create index if not exists attendance_submissions_service
  on attendance_submissions (activity_id, service_date);
create index if not exists attendance_submissions_subunit
  on attendance_submissions (subunit_id);

alter table attendance_submissions enable row level security;

-- ============================================================================
-- 4. Who may write attendance
-- ============================================================================
-- True when the current user leads the subunit that `member` belongs to as
-- their PRIMARY subunit.
--
-- Deliberately narrower than leads_member(): a person can sit in up to four
-- subunits, but is reported by exactly one of them, so secondary leaders must
-- not be able to overwrite a colleague's numbers.
create or replace function public.leads_primary_subunit_of(member uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from subunit_members sm
    join subunit_members ld on ld.subunit_id = sm.subunit_id
    where sm.user_id = member
      and sm.membership_type = 'primary'
      and ld.user_id = auth.uid()
      and ld.role_in_subunit = 'leader'
  );
$$;

-- The old policy was secretary/super-admin only, so a subunit leader could read
-- attendance but never record it. Welfare does the calling that produces the
-- absentee list, so they need it too.
drop policy if exists attendance_records_write on attendance_records;
create policy attendance_records_write on attendance_records for all using (
  public.is_super_admin()
  or public.has_role('secretary')
  or public.has_role('welfare')
  or public.leads_primary_subunit_of(user_id)
) with check (
  public.is_super_admin()
  or public.has_role('secretary')
  or public.has_role('welfare')
  or public.leads_primary_subunit_of(user_id)
);

drop policy if exists attendance_submissions_select on attendance_submissions;
create policy attendance_submissions_select on attendance_submissions for select using (
  public.is_super_admin()
  or public.has_role('secretary')
  or public.has_role('welfare')
  or public.leads_subunit(subunit_id)
);

drop policy if exists attendance_submissions_write on attendance_submissions;
create policy attendance_submissions_write on attendance_submissions for all using (
  public.is_super_admin()
  or public.has_role('secretary')
  or public.has_role('welfare')
  or public.leads_subunit(subunit_id)
) with check (
  public.is_super_admin()
  or public.has_role('secretary')
  or public.has_role('welfare')
  or public.leads_subunit(subunit_id)
);

-- ============================================================================
-- 5. Bible Study now counts toward welfare follow-ups
-- ============================================================================
-- Previously only Sunday Service was an attendance signal, so missing Bible
-- Study never reached the welfare board.
update activities set is_attendance_signal = true where name = 'Bible Study';

-- ============================================================================
-- 6. Department roll for the report header
-- ============================================================================
-- "Total Members: 101" counts everyone still on the roll — graduated and left
-- are off it. Exposed as a definer function because a leader cannot read the
-- whole profiles table under RLS, but the department total is safe to show.
create or replace function public.attendance_roll_total()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from profiles
  where member_status not in ('graduated', 'left');
$$;
