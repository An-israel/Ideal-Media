-- ============================================================================
--  01_find_duplicates.sql  —  CHANGES NOTHING. Read it.
-- ============================================================================
--  Two accounts for one person split their attendance across both records and
--  push the headcount above the real number of members. The members list has
--  at least one such pair ("Owan Flourish Worma" and "Owan Flourish", which
--  the department has confirmed is one person), so it is worth checking the
--  site for others before trusting any total.
-- ============================================================================

-- Same phone number on two accounts — the strongest signal there is.
select public.im_phone_key(phone) as shared_number,
       string_agg(full_name, '  |  ' order by full_name) as accounts,
       count(*) as how_many
from profiles
where public.im_phone_key(phone) is not null
group by public.im_phone_key(phone)
having count(*) > 1
order by count(*) desc;

-- Same set of name words, in any order.
select public.im_name_set(full_name) as same_names,
       string_agg(full_name || coalesce(' (' || phone || ')', ''), '  |  ') as accounts,
       count(*) as how_many
from profiles
group by public.im_name_set(full_name)
having count(*) > 1
order by count(*) desc;

-- One person's name wholly inside another's — "Owan Flourish" vs "Owan
-- Flourish Worma". Some of these are genuinely different people who share
-- names, so read each pair rather than acting on the list.
select a.full_name as shorter, a.phone as shorter_phone,
       b.full_name as longer,  b.phone as longer_phone
from profiles a
join profiles b
  -- NOT "a.id < b.id": the containment test below is directional, and ids are
  -- random UUIDs, so ordering by id skipped the pair whenever the longer name
  -- happened to sort first — missing half of exactly what this looks for.
  -- Because the sets must differ and one is strictly inside the other, only
  -- one direction can hold, so each pair still appears once.
  on a.id <> b.id
 and array_length(public.im_name_arr(a.full_name), 1) >= 2
 and public.im_name_arr(a.full_name) <@ public.im_name_arr(b.full_name)
 and public.im_name_set(a.full_name) <> public.im_name_set(b.full_name)
order by a.full_name;
