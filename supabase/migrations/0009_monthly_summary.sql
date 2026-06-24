-- Historical monthly attendance tallies (e.g. "attended 5 times in March").
-- Used for past months where only a per-month count is known, not the
-- individual service dates. Current/future months are tracked per-service in
-- attendance_records and totalled automatically.
create table if not exists public.monthly_attendance_summary (
  user_id uuid not null references public.profiles(id) on delete cascade,
  period text not null,                       -- 'YYYY-MM'
  count int not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, period)
);

alter table public.monthly_attendance_summary enable row level security;

create policy monthly_summary_select on public.monthly_attendance_summary for select using (
  user_id = auth.uid()
  or public.is_super_admin()
  or public.has_role('secretary')
  or public.has_role('welfare')
  or public.leads_member(user_id)
);
create policy monthly_summary_write on public.monthly_attendance_summary for all using (
  public.has_role('secretary') or public.is_super_admin()
) with check (
  public.has_role('secretary') or public.is_super_admin()
);
