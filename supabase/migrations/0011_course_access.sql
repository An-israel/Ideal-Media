-- Cross-subunit course applications: three access fixes.
--
-- 1. course_visible never granted access to members enrolled BY APPROVAL —
--    an approved cross-subunit applicant couldn't open the course (or even
--    see it in My Courses). Include active enrollments.
-- 2. Members could not browse secondary-category courses to apply for them
--    (visibility required existing subunit membership — circular). Published
--    courses in secondary-category subunits are now browseable by any
--    authenticated user, which is the point of the application flow.
-- 3. Re-applying after a rejection was blocked: the upsert's UPDATE path had
--    no member policy. Members may update their own rejected/pending row, and
--    only ever into 'pending_application' (never self-enroll).

create or replace function public.course_visible(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from courses c
    where c.id = cid and (
      public.is_super_admin()
      or c.created_by = auth.uid()
      or public.leads_subunit(c.subunit_id)
      or (c.is_published and public.is_member_of(c.subunit_id))
      or exists (
        select 1 from enrollments e
        where e.course_id = c.id and e.user_id = auth.uid() and e.status = 'enrolled'
      )
      or (
        c.is_published
        and auth.uid() is not null
        and exists (select 1 from subunits s where s.id = c.subunit_id and s.category = 'secondary')
      )
    )
  );
$$;

do $$ begin
  create policy enrollments_update_self on enrollments for update
    using (user_id = auth.uid() and status in ('rejected', 'pending_application'))
    with check (user_id = auth.uid() and status = 'pending_application');
exception when duplicate_object then null; end $$;
