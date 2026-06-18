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
