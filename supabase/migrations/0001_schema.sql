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
