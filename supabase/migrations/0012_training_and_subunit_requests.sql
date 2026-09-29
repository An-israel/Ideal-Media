-- Ideal Media — General Training + member-driven subunit changes.
--
-- 1. General training: a department-wide teaching series every member can reach
--    from their own dashboard, with real listen tracking so the admin can see
--    who has and has not been through each teaching.
-- 2. Subunit self-service: members browse every subunit, join extra ones
--    instantly, and request a change of PRIMARY subunit (which drives attendance
--    and auto-enrolled courses, so a leader/secretary approves it).

-- ============================================================================
-- 1. General training
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'teaching_media_type') then
    create type teaching_media_type as enum ('audio', 'video', 'link');
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_type where typname = 'teaching_completion_source') then
    create type teaching_completion_source as enum ('playback', 'manual');
  end if;
end $$;

-- A series groups teachings, e.g. "Essence of Media".
create table if not exists training_series (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  position int not null default 1,
  is_published boolean not null default false,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists training_series_position on training_series (position);

create table if not exists training_teachings (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references training_series (id) on delete cascade,
  position int not null,
  title text not null,
  description text,
  media_type teaching_media_type not null default 'audio',
  /** Object key inside the private `training` storage bucket (uploads). */
  storage_path text,
  /** Used instead of storage_path for a link-type teaching. */
  external_url text,
  /**
   * Length in seconds. Populated from the media itself the first time someone
   * plays it, so the listened percentage has a denominator without the admin
   * having to type one in.
   */
  duration_seconds int,
  is_published boolean not null default false,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (series_id, position),
  -- An uploaded teaching needs a file; a link teaching needs a URL.
  constraint teaching_has_media check (
    (media_type = 'link' and external_url is not null)
    or (media_type <> 'link' and storage_path is not null)
  )
);
create index if not exists training_teachings_series_position on training_teachings (series_id, position);

/**
 * One row per member per teaching.
 *
 * `listened_seconds` accumulates only real playback time, which is the honest
 * measure: dragging the slider to the end moves `furthest_seconds` to 100% but
 * leaves `listened_seconds` at almost nothing. Completion is decided on
 * listened_seconds, so "has listened" means it.
 */
create table if not exists teaching_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  teaching_id uuid not null references training_teachings (id) on delete cascade,
  /** Total seconds actually played (survives pauses; not inflated by seeking). */
  listened_seconds int not null default 0,
  /** Furthest position reached, so playback can resume where they left off. */
  furthest_seconds int not null default 0,
  completed boolean not null default false,
  completed_at timestamptz,
  completion_source teaching_completion_source,
  first_opened_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, teaching_id)
);
create index if not exists teaching_progress_teaching_completed on teaching_progress (teaching_id, completed);
create index if not exists teaching_progress_user on teaching_progress (user_id);

alter table training_series    enable row level security;
alter table training_teachings enable row level security;
alter table teaching_progress  enable row level security;

/** Super admin or secretary manages the training library. */
create or replace function public.manages_training()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or public.has_role('secretary');
$$;

-- Everyone reads published training; managers also see unpublished drafts.
drop policy if exists training_series_select on training_series;
create policy training_series_select on training_series for select using (
  is_published or public.manages_training()
);
drop policy if exists training_series_write on training_series;
create policy training_series_write on training_series for all
  using (public.manages_training()) with check (public.manages_training());

drop policy if exists training_teachings_select on training_teachings;
create policy training_teachings_select on training_teachings for select using (
  (
    is_published
    and exists (
      select 1 from training_series s where s.id = series_id and s.is_published
    )
  )
  or public.manages_training()
);
drop policy if exists training_teachings_write on training_teachings;
create policy training_teachings_write on training_teachings for all
  using (public.manages_training()) with check (public.manages_training());

-- A member reads and writes only their own progress. Managers see everyone's
-- (that is the whole point of the report), and a leader sees their own members'.
drop policy if exists teaching_progress_select on teaching_progress;
create policy teaching_progress_select on teaching_progress for select using (
  user_id = auth.uid()
  or public.manages_training()
  or public.leads_member(user_id)
);
drop policy if exists teaching_progress_insert on teaching_progress;
create policy teaching_progress_insert on teaching_progress for insert with check (
  user_id = auth.uid()
);
drop policy if exists teaching_progress_update on teaching_progress;
create policy teaching_progress_update on teaching_progress for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Private bucket for uploaded teachings. Reads go through short-lived signed
-- URLs minted server-side, so the media is never publicly listable.
insert into storage.buckets (id, name, public)
values ('training', 'training', false)
on conflict (id) do nothing;

-- Raise the per-object limit for this bucket to match MAX_TEACHING_UPLOAD_BYTES
-- (200MB) — a full teaching is far bigger than the default. Guarded because the
-- column only exists on a real Supabase instance.
--
-- NOTE: the PROJECT also has a global upload limit (Dashboard → Storage →
-- Settings). If it is lower than 200MB it wins, and long teachings will be
-- rejected no matter what this says.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit'
  ) then
    update storage.buckets set file_size_limit = 209715200 where id = 'training';
  end if;
end $$;

drop policy if exists training_media_read on storage.objects;
create policy training_media_read on storage.objects for select using (
  bucket_id = 'training' and auth.uid() is not null
);

drop policy if exists training_media_write on storage.objects;
create policy training_media_write on storage.objects for insert with check (
  bucket_id = 'training' and public.manages_training()
);

drop policy if exists training_media_update on storage.objects;
create policy training_media_update on storage.objects for update using (
  bucket_id = 'training' and public.manages_training()
);

drop policy if exists training_media_delete on storage.objects;
create policy training_media_delete on storage.objects for delete using (
  bucket_id = 'training' and public.manages_training()
);

-- ============================================================================
-- 2. Member-driven subunit changes
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'subunit_request_kind') then
    create type subunit_request_kind as enum ('change_primary');
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_type where typname = 'subunit_request_status') then
    create type subunit_request_status as enum ('pending', 'approved', 'rejected', 'cancelled');
  end if;
end $$;

/**
 * A request to change PRIMARY subunit.
 *
 * Joining or leaving an EXTRA (secondary) subunit is instant and needs no row
 * here — it costs nothing to undo. Primary is different: it decides which
 * attendance roster the member appears on and which courses auto-enroll them,
 * so a leader or secretary signs it off.
 */
create table if not exists subunit_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  /** The subunit they want as their new primary. */
  subunit_id uuid not null references subunits (id) on delete cascade,
  /** Their primary at the time of asking, for the reviewer's context. */
  current_subunit_id uuid references subunits (id) on delete set null,
  kind subunit_request_kind not null default 'change_primary',
  status subunit_request_status not null default 'pending',
  reason text,
  decided_by uuid references profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists subunit_requests_status_subunit on subunit_requests (status, subunit_id);
create index if not exists subunit_requests_user on subunit_requests (user_id);

-- At most one pending request per member, so the queue can't be flooded.
create unique index if not exists one_pending_subunit_request
  on subunit_requests (user_id) where status = 'pending';

alter table subunit_requests enable row level security;

-- The member sees their own; reviewers see anything for a subunit they lead,
-- plus secretaries and super admins.
drop policy if exists subunit_requests_select on subunit_requests;
create policy subunit_requests_select on subunit_requests for select using (
  user_id = auth.uid()
  or public.is_super_admin()
  or public.has_role('secretary')
  or public.leads_subunit(subunit_id)
  or public.leads_subunit(current_subunit_id)
);

-- A member may only ever raise a PENDING request for THEMSELVES, and may not
-- pre-fill the decision fields.
drop policy if exists subunit_requests_insert on subunit_requests;
create policy subunit_requests_insert on subunit_requests for insert with check (
  user_id = auth.uid()
  and status = 'pending'
  and decided_by is null
  and decided_at is null
);

-- Reviewers decide. A member may also touch their OWN request, but only to
-- cancel it — WITH CHECK is what enforces that.
--
-- Without the WITH CHECK, `user_id = auth.uid()` in USING let a member run
-- `update subunit_requests set status = 'approved'` straight from the browser
-- with the anon key and mark their own move approved. Same shape as the
-- self-approval hole the audit found on module_progress (SEC-2): USING decides
-- which rows you may touch, WITH CHECK decides what you may write.
drop policy if exists subunit_requests_update on subunit_requests;
create policy subunit_requests_update on subunit_requests for update using (
  public.is_super_admin()
  or public.has_role('secretary')
  or public.leads_subunit(subunit_id)
  or public.leads_subunit(current_subunit_id)
  or user_id = auth.uid()
) with check (
  public.is_super_admin()
  or public.has_role('secretary')
  or public.leads_subunit(subunit_id)
  or public.leads_subunit(current_subunit_id)
  or (
    user_id = auth.uid()
    and status = 'cancelled'
    and decided_by is null
    and decided_at is null
  )
);

-- ============================================================================
-- 3. Let members read the subunit roster counts they browse
-- ============================================================================
-- The browse page shows how many people are in each subunit. subunit_members is
-- readable only for your own rows, your subunit (as leader), or by
-- secretary/welfare/super admin — so a plain member cannot count it. A
-- SECURITY DEFINER view keeps the row data private while exposing only totals.
create or replace function public.subunit_member_counts()
returns table (subunit_id uuid, member_count bigint)
language sql stable security definer set search_path = public as $$
  select sm.subunit_id, count(*)::bigint
  from subunit_members sm
  join profiles p on p.id = sm.user_id
  where p.member_status = 'active'
  group by sm.subunit_id;
$$;

-- ============================================================================
-- 4. updated_at triggers for the new tables
-- ============================================================================
do $$
declare
  t text;
begin
  foreach t in array array['training_series','training_teachings','subunit_requests'] loop
    execute format('drop trigger if exists touch_%1$s on %1$s', t);
    execute format(
      'create trigger touch_%1$s before update on %1$s for each row execute function public.touch_updated_at()', t
    );
  end loop;
end $$;
