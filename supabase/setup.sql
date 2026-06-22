-- ============================================================================
-- Ideal Media — FULL DATABASE SETUP (paste this whole file into the
-- Supabase SQL Editor and click Run). It creates every table, all security
-- policies, and the starter data. Safe to run once on a brand-new project.
-- ============================================================================

-- Ideal Media — schema (Section 5)
-- All tables: id uuid default gen_random_uuid(), created_at timestamptz default now().
-- RLS is enabled and policed in 0002_rls.sql.

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
create type role as enum ('member', 'subunit_leader', 'secretary', 'welfare', 'super_admin');
create type member_status as enum ('active', 'inactive', 'traveled', 'graduated', 'left');
create type subunit_category as enum ('primary', 'secondary');
create type membership_type as enum ('primary', 'secondary');
create type role_in_subunit as enum ('member', 'leader');
create type content_type as enum ('article', 'youtube', 'video', 'file', 'link', 'other');
create type enrollment_status as enum ('enrolled', 'pending_application', 'rejected');
create type module_progress_status as enum ('not_started', 'in_progress', 'submitted', 'approved');
create type upload_status as enum ('parsing', 'needs_review', 'committed', 'discarded');
create type attendance_status as enum ('present', 'absent', 'traveled', 'excused');
create type attendance_source as enum ('sheet_upload', 'manual');
create type welfare_reason as enum ('new_member', 'missed_service', 'traveled');
create type welfare_status as enum ('pending', 'in_progress', 'contacted', 'resolved');

-- ----------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- ----------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text,
  location text,
  whatsapp_number text,
  avatar_url text,
  member_status member_status not null default 'active',
  coc_completed boolean not null default false,
  coc_completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  role role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
create index on user_roles (user_id);

create table subunits (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  category subunit_category not null,
  description text,
  created_at timestamptz not null default now()
);

create table subunit_members (
  id uuid primary key default gen_random_uuid(),
  subunit_id uuid not null references subunits (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  membership_type membership_type not null,
  role_in_subunit role_in_subunit not null default 'member',
  created_at timestamptz not null default now(),
  unique (subunit_id, user_id)
);
create index on subunit_members (user_id);
create index on subunit_members (subunit_id);
-- Each user has at most one primary membership.
create unique index one_primary_per_user on subunit_members (user_id) where membership_type = 'primary';

create table courses (
  id uuid primary key default gen_random_uuid(),
  subunit_id uuid not null references subunits (id) on delete cascade,
  title text not null,
  description text,
  created_by uuid not null references profiles (id),
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);
create index on courses (subunit_id);

create table modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses (id) on delete cascade,
  position int not null,
  title text not null,
  content_type content_type not null default 'article',
  content_url text,
  content_body text,
  created_at timestamptz not null default now(),
  unique (course_id, position)
);
create index on modules (course_id);

create table assignments (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null unique references modules (id) on delete cascade,
  instructions text not null,
  created_at timestamptz not null default now()
);

create table enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  course_id uuid not null references courses (id) on delete cascade,
  status enrollment_status not null default 'enrolled',
  application_reason text,
  decided_by uuid references profiles (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, course_id)
);
create index on enrollments (course_id);
create index on enrollments (user_id);

create table module_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  module_id uuid not null references modules (id) on delete cascade,
  status module_progress_status not null default 'not_started',
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references profiles (id),
  rejection_note text,
  created_at timestamptz not null default now(),
  unique (user_id, module_id)
);
create index on module_progress (user_id);
create index on module_progress (module_id);

create table code_of_conduct (
  id uuid primary key default gen_random_uuid(),
  version int not null,
  title text not null,
  body text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);
-- Only one active version at a time.
create unique index one_active_coc on code_of_conduct (is_active) where is_active;

create table coc_questions (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  options jsonb not null,
  correct_option_index int not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table coc_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  passed boolean not null,
  score int not null,
  total int not null,
  attempted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index on coc_attempts (user_id);

create table activities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  day_of_week text not null,
  time_of_day text not null,
  is_attendance_signal boolean not null default false,
  created_at timestamptz not null default now()
);

create table attendance_uploads (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid not null references profiles (id),
  original_filename text not null,
  raw_storage_path text not null,
  activity_id uuid not null references activities (id),
  service_date date not null,
  status upload_status not null default 'parsing',
  ai_proposal jsonb,
  committed_at timestamptz,
  created_at timestamptz not null default now()
);

create table attendance_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  activity_id uuid not null references activities (id),
  service_date date not null,
  status attendance_status not null,
  source attendance_source not null default 'sheet_upload',
  upload_id uuid references attendance_uploads (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, activity_id, service_date)
);
create index on attendance_records (user_id);
create index on attendance_records (activity_id, service_date);

create table welfare_followups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  reason welfare_reason not null,
  level int not null default 1 check (level between 1 and 3),
  status welfare_status not null default 'pending',
  auto_flagged boolean not null default false,
  notes text,
  assigned_to uuid references profiles (id),
  last_contact_at timestamptz,
  created_at timestamptz not null default now()
);
create index on welfare_followups (status, reason);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index on notifications (user_id, is_read);

-- App-level settings (missed-service threshold etc. — Section 11).
create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);


-- Ideal Media — Row Level Security (Section 16 is the acceptance checklist).
-- RLS is the security model: every table is enabled, every access path is an
-- explicit policy. Privileged writes (attendance commit, role changes) go
-- through the service-role admin client which bypasses RLS by design.

-- ----------------------------------------------------------------------------
-- Helper functions. SECURITY DEFINER so they can read user_roles /
-- subunit_members without tripping those tables' own RLS (avoids recursion).
-- ----------------------------------------------------------------------------
create or replace function public.has_role(r role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role = r);
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role = 'super_admin');
$$;

create or replace function public.leads_subunit(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from subunit_members sm
    where sm.user_id = auth.uid() and sm.subunit_id = sid and sm.role_in_subunit = 'leader'
  );
$$;

create or replace function public.is_member_of(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from subunit_members sm where sm.user_id = auth.uid() and sm.subunit_id = sid
  );
$$;

-- True when the current user leads any subunit that `member` belongs to.
create or replace function public.leads_member(member uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from subunit_members sm
    join subunit_members ld on ld.subunit_id = sm.subunit_id
    where sm.user_id = member
      and ld.user_id = auth.uid()
      and ld.role_in_subunit = 'leader'
  );
$$;

-- Subunit id for a given course (SECURITY DEFINER so module/course policies can
-- resolve the subunit without recursive RLS on courses).
create or replace function public.course_subunit(cid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select subunit_id from courses where id = cid;
$$;

create or replace function public.course_visible(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from courses c
    where c.id = cid and (
      public.is_super_admin()
      or c.created_by = auth.uid()
      or public.leads_subunit(c.subunit_id)
      or (c.is_published and public.is_member_of(c.subunit_id))
    )
  );
$$;

-- ----------------------------------------------------------------------------
-- Enable RLS everywhere
-- ----------------------------------------------------------------------------
alter table profiles            enable row level security;
alter table user_roles          enable row level security;
alter table subunits            enable row level security;
alter table subunit_members     enable row level security;
alter table courses             enable row level security;
alter table modules             enable row level security;
alter table assignments         enable row level security;
alter table enrollments         enable row level security;
alter table module_progress     enable row level security;
alter table code_of_conduct     enable row level security;
alter table coc_questions       enable row level security;
alter table coc_attempts        enable row level security;
alter table activities          enable row level security;
alter table attendance_uploads  enable row level security;
alter table attendance_records  enable row level security;
alter table welfare_followups   enable row level security;
alter table notifications       enable row level security;
alter table app_settings        enable row level security;

-- ----------------------------------------------------------------------------
-- profiles
-- ----------------------------------------------------------------------------
create policy profiles_select on profiles for select using (
  id = auth.uid()
  or public.is_super_admin()
  or public.has_role('secretary')
  or public.has_role('welfare')
  or public.leads_member(id)
);
create policy profiles_insert on profiles for insert with check (id = auth.uid());
create policy profiles_update_self on profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_admin on profiles for update using (
  public.is_super_admin() or public.has_role('secretary')
);

-- ----------------------------------------------------------------------------
-- user_roles  (changes happen via admin client after an app-level check)
-- ----------------------------------------------------------------------------
create policy user_roles_select on user_roles for select using (
  user_id = auth.uid() or public.is_super_admin()
);
create policy user_roles_write on user_roles for all using (public.is_super_admin())
  with check (public.is_super_admin());

-- ----------------------------------------------------------------------------
-- subunits  (public read — needed by the signup picker; super admin writes)
-- ----------------------------------------------------------------------------
create policy subunits_select on subunits for select using (true);
create policy subunits_write on subunits for all using (public.is_super_admin())
  with check (public.is_super_admin());

-- ----------------------------------------------------------------------------
-- subunit_members
-- ----------------------------------------------------------------------------
create policy subunit_members_select on subunit_members for select using (
  user_id = auth.uid()
  or public.is_super_admin()
  or public.has_role('secretary')
  or public.has_role('welfare')
  or public.leads_subunit(subunit_id)
);
create policy subunit_members_insert_self on subunit_members for insert with check (
  user_id = auth.uid() or public.is_super_admin()
);
create policy subunit_members_write_admin on subunit_members for all using (public.is_super_admin())
  with check (public.is_super_admin());

-- ----------------------------------------------------------------------------
-- courses
-- ----------------------------------------------------------------------------
create policy courses_select on courses for select using (
  public.is_super_admin()
  or created_by = auth.uid()
  or public.leads_subunit(subunit_id)
  or (is_published and public.is_member_of(subunit_id))
);
create policy courses_insert on courses for insert with check (
  (public.leads_subunit(subunit_id) and created_by = auth.uid()) or public.is_super_admin()
);
create policy courses_update on courses for update using (
  public.is_super_admin() or created_by = auth.uid() or public.leads_subunit(subunit_id)
);
create policy courses_delete on courses for delete using (
  public.is_super_admin() or created_by = auth.uid() or public.leads_subunit(subunit_id)
);

-- ----------------------------------------------------------------------------
-- modules / assignments  (visibility follows the parent course)
-- ----------------------------------------------------------------------------
create policy modules_select on modules for select using (public.course_visible(course_id));
create policy modules_write on modules for all using (
  public.is_super_admin() or public.leads_subunit(public.course_subunit(course_id))
) with check (
  public.is_super_admin() or public.leads_subunit(public.course_subunit(course_id))
);

create policy assignments_select on assignments for select using (
  exists (select 1 from modules m where m.id = assignments.module_id and public.course_visible(m.course_id))
);
create policy assignments_write on assignments for all using (
  exists (select 1 from modules m where m.id = assignments.module_id
          and (public.is_super_admin() or public.leads_subunit(public.course_subunit(m.course_id))))
) with check (
  exists (select 1 from modules m where m.id = assignments.module_id
          and (public.is_super_admin() or public.leads_subunit(public.course_subunit(m.course_id))))
);

-- ----------------------------------------------------------------------------
-- enrollments
-- ----------------------------------------------------------------------------
create policy enrollments_select on enrollments for select using (
  user_id = auth.uid()
  or public.is_super_admin()
  or public.leads_subunit(public.course_subunit(course_id))
);
create policy enrollments_insert_self on enrollments for insert with check (
  user_id = auth.uid() or public.is_super_admin()
);
create policy enrollments_update on enrollments for update using (
  public.is_super_admin() or public.leads_subunit(public.course_subunit(course_id))
);

-- ----------------------------------------------------------------------------
-- module_progress
-- ----------------------------------------------------------------------------
create policy module_progress_select on module_progress for select using (
  user_id = auth.uid()
  or public.is_super_admin()
  or public.leads_subunit(public.course_subunit((select course_id from modules where id = module_progress.module_id)))
);
create policy module_progress_insert_self on module_progress for insert with check (user_id = auth.uid());
create policy module_progress_update on module_progress for update using (
  user_id = auth.uid()
  or public.is_super_admin()
  or public.leads_subunit(public.course_subunit((select course_id from modules where id = module_progress.module_id)))
);

-- ----------------------------------------------------------------------------
-- code_of_conduct  (everyone reads the active doc; super admin edits)
-- ----------------------------------------------------------------------------
create policy coc_select on code_of_conduct for select using (true);
create policy coc_write on code_of_conduct for all using (public.is_super_admin())
  with check (public.is_super_admin());

-- coc_questions: NEVER expose correct_option_index to members. Only super
-- admin can read directly; the quiz fetches/grades through a server action
-- using the admin client.
create policy coc_questions_admin on coc_questions for all using (public.is_super_admin())
  with check (public.is_super_admin());

-- coc_attempts: a member sees/inserts only their own.
create policy coc_attempts_select on coc_attempts for select using (
  user_id = auth.uid() or public.is_super_admin()
);
create policy coc_attempts_insert on coc_attempts for insert with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- activities / app_settings  (read by all authenticated; super admin writes)
-- ----------------------------------------------------------------------------
create policy activities_select on activities for select using (true);
create policy activities_write on activities for all using (public.is_super_admin())
  with check (public.is_super_admin());

create policy app_settings_select on app_settings for select using (true);
create policy app_settings_write on app_settings for all using (public.is_super_admin())
  with check (public.is_super_admin());

-- ----------------------------------------------------------------------------
-- attendance_uploads  (secretary + super admin)
-- ----------------------------------------------------------------------------
create policy attendance_uploads_select on attendance_uploads for select using (
  public.has_role('secretary') or public.is_super_admin()
);
create policy attendance_uploads_write on attendance_uploads for all using (
  public.has_role('secretary') or public.is_super_admin()
) with check (
  public.has_role('secretary') or public.is_super_admin()
);

-- ----------------------------------------------------------------------------
-- attendance_records
-- ----------------------------------------------------------------------------
create policy attendance_records_select on attendance_records for select using (
  user_id = auth.uid()
  or public.is_super_admin()
  or public.has_role('secretary')
  or public.has_role('welfare')
  or public.leads_member(user_id)
);
create policy attendance_records_write on attendance_records for all using (
  public.has_role('secretary') or public.is_super_admin()
) with check (
  public.has_role('secretary') or public.is_super_admin()
);

-- ----------------------------------------------------------------------------
-- welfare_followups  (welfare + super admin)
-- ----------------------------------------------------------------------------
create policy welfare_select on welfare_followups for select using (
  public.has_role('welfare') or public.is_super_admin()
);
create policy welfare_write on welfare_followups for all using (
  public.has_role('welfare') or public.is_super_admin()
) with check (
  public.has_role('welfare') or public.is_super_admin()
);

-- ----------------------------------------------------------------------------
-- notifications  (own read/update; inserts come from the server/admin client)
-- ----------------------------------------------------------------------------
create policy notifications_select on notifications for select using (
  user_id = auth.uid() or public.is_super_admin()
);
create policy notifications_update on notifications for update using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy notifications_insert on notifications for insert with check (public.is_super_admin());


-- Ideal Media — seed data (Section 4). Idempotent where practical.

-- Subunits ------------------------------------------------------------------
insert into subunits (name, slug, category) values
  ('Photography', 'photography', 'primary'),
  ('Projection', 'projection', 'primary'),
  ('Production', 'production', 'primary'),
  ('Social Media', 'social-media', 'primary'),
  ('Utility (Videography & Technical)', 'utility', 'primary'),
  ('Graphic Design', 'graphic-design', 'secondary'),
  ('Video Editing', 'video-editing', 'secondary'),
  ('Welfare', 'welfare', 'secondary'),
  ('Secretary', 'secretary', 'secondary'),
  ('Publication', 'publication', 'secondary')
on conflict (slug) do nothing;

-- Activities ----------------------------------------------------------------
insert into activities (name, day_of_week, time_of_day, is_attendance_signal) values
  ('Sunday Service', 'Sunday', 'Morning', true),
  ('Bible Study', 'Wednesday', 'Evening', false),
  ('Morning Prayer', 'Saturday', 'Morning', false),
  ('Set Up', 'Saturday', 'Evening', false)
on conflict do nothing;

-- App settings --------------------------------------------------------------
insert into app_settings (key, value) values
  ('missed_service_threshold', '2'::jsonb)
on conflict (key) do nothing;

-- Code of conduct -----------------------------------------------------------
insert into code_of_conduct (version, title, body, is_active) values
  (1, 'Media Department Code of Conduct',
$$# Media Department Code of Conduct

Welcome to the media team. As a member you represent the department in
everything you do. Please read this carefully before continuing.

## 1. Commitment
Members are expected to attend Sunday Service and the activities relevant to
their subunit. Consistent absence without notice will be followed up by the
welfare team.

## 2. Conduct
Treat fellow members, leaders, and the congregation with respect. Handle all
equipment with care and report any damage immediately.

## 3. Confidentiality
Footage, photographs, and recordings belong to the church. Do not share or
publish any material without approval from your subunit leader.

## 4. Growth
Complete the courses assigned to your subunit. Each module must be approved by
your leader before you move on. Submit your assignments promptly.

## 5. Communication
Assignment submissions are coordinated with your leader over WhatsApp. Keep
your contact details up to date.

By agreeing below you confirm that you have read and understood this code of
conduct and agree to abide by it.$$,
  true)
on conflict do nothing;

-- COC question bank ---------------------------------------------------------
insert into coc_questions (question, options, correct_option_index, is_active) values
  ('Which service is the primary attendance signal for the media team?',
   '["Bible Study","Sunday Service","Morning Prayer","Set Up"]'::jsonb, 1, true),
  ('Before you can start the next module in a course, what must happen?',
   '["Nothing, all modules are open","Your leader must approve the previous module''s assignment","You must pay a fee","An admin must email you"]'::jsonb, 1, true),
  ('Who do footage and photographs you capture belong to?',
   '["You personally","Your subunit leader","The church","Whoever is in the photo"]'::jsonb, 2, true),
  ('How are assignment submissions coordinated with your leader?',
   '["By post","Over WhatsApp","In person only","They are not coordinated"]'::jsonb, 1, true),
  ('What should you do if you damage a piece of equipment?',
   '["Hide it","Report it immediately","Replace it secretly","Ignore it"]'::jsonb, 1, true),
  ('Can you publish church media material without approval?',
   '["Yes, anytime","Only on weekends","No, you need approval from your subunit leader","Yes, if it looks good"]'::jsonb, 2, true),
  ('What happens if you are absent from service repeatedly without notice?',
   '["Nothing","The welfare team will follow up with you","You are removed instantly","You get a fine"]'::jsonb, 1, true),
  ('How many primary subunits must every member belong to?',
   '["Zero","Exactly one","At least three","As many as they like"]'::jsonb, 1, true)
on conflict do nothing;


-- Ideal Media — Supabase Storage for attendance uploads (Section 12).
-- Private bucket; only secretary/super_admin can read/write. Commits use the
-- admin client which bypasses these policies, but we scope them anyway.

insert into storage.buckets (id, name, public)
values ('attendance', 'attendance', false)
on conflict (id) do nothing;

create policy attendance_read on storage.objects for select using (
  bucket_id = 'attendance'
  and (public.has_role('secretary') or public.is_super_admin())
);

create policy attendance_write on storage.objects for insert with check (
  bucket_id = 'attendance'
  and (public.has_role('secretary') or public.is_super_admin())
);

create policy attendance_update on storage.objects for update using (
  bucket_id = 'attendance'
  and (public.has_role('secretary') or public.is_super_admin())
);


-- Adds a "claimed" flag so bulk-imported members can be claimed at signup by
-- phone/email (they set their own password then) instead of via reset emails.
-- Normal signups are claimed immediately; imported rows are created unclaimed.
alter table profiles add column if not exists claimed boolean not null default true;


-- How each member entered the system, so you can tell self-signups apart from
-- people added via the secretary import or by welfare. Preserved even after an
-- imported/welfare member later claims their account by signing up.
alter table profiles add column if not exists member_origin text not null default 'self_signup';
-- Backfill: anyone not yet claimed was added by import/welfare (treat as import).
update profiles set member_origin = 'import' where claimed = false and member_origin = 'self_signup';
