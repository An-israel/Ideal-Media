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
