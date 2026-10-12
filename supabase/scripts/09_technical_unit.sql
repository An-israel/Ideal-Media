-- ============================================================================
--  09_technical_unit.sql  —  THIS CHANGES DATA.
-- ============================================================================
--  Run 00_helpers.sql first. Nothing else is needed: this script is complete
--  on its own and safe to run more than once.
--
--  It does two things for the 29 names on the Technical (Utility) sheet:
--
--    1. Puts back anyone who was marked 'left' by 04_remove_not_on_list.sql.
--       They are current members of a subunit, so they stay — the same rule
--       07_keep_subunit_people.sql applies to the other units.
--    2. Makes them PRIMARY members of Utility (Videography & Technical), and takes out anyone
--       currently primary there who is not on the sheet.
--
--  Two phone numbers on the sheet are left out below on purpose, because
--  using them would claim the wrong person's account:
--
--    * "kelvin  07088980666" — that number belongs to Chika Chukwuelokalum
--      Benedict on the members list. Either kelvin is that person under a
--      different name, or the number is a typo. Nothing in the data settles
--      it, so the name is matched on its own and reported instead.
--    * "gift Eze  070676502264" — twelve digits, so it is not a Nigerian
--      number. A truncated match could claim somebody else.
--
--  One spelling was checked by hand: the sheet's "omekodinma Victoria" is
--  "Victoria Omekaodinma" on the members list (the sheet drops an 'a').
--
--  "Chiwendu  09167975892" matches Chinedu Chidumebi by phone number exactly,
--  and the names are one letter apart, so it is treated as the same person.
--  It is listed under moved_here / the counts so you can confirm it.
--
--  Everything runs in ONE transaction: if any part fails, nothing changes.
-- ============================================================================

begin;

create temporary table im_unmatched(unit text, listed_name text) on commit drop;
create temporary table im_report(unit text, action text, n int) on commit drop;

create temporary table im_alias(sheet_name text, official_name text) on commit drop;
-- Spellings that differ between this sheet and the members list, each one
-- checked by hand. BOTH spellings are shown so you can verify them.
insert into im_alias(sheet_name, official_name) values
  ('omekodinma Victoria', 'Victoria Omekaodinma');

-- ----------------------------------------------------------------------------
--  Step 1 — put back anyone on this sheet who was removed.
-- ----------------------------------------------------------------------------
create temporary table im_solo_sheet(full_name text, phone text) on commit drop;
insert into im_solo_sheet(full_name, phone) values
    ('divine oluwa', '08084477742'),
    ('Aniobi smiles', '08152878749'),
    ('Chibueze nwachukwu', '08146359618'),
    ('Chidibere success', '09119229230'),
    ('Ezenwa Emmanuel', '08023813695'),
    ('Ifeoma Nnam', '08086478211'),
    ('David Milagro', '09060694909'),
    ('Nathaniel Peter', '07087135592'),
    ('okereke goodness', '08117828223'),
    ('Oluchi Eze', '09031277384'),
    ('Pamela Orji', '07061669987'),
    ('precious Okechukwu', '07047146684'),
    ('Somto okafor', '09015589563'),
    ('Rhema ubakibie', '08166364341'),
    ('Samuel nwaigwe', '07044205365'),
    ('Sunday divine', '08112175408'),
    ('victor igattah', '09130254153'),
    ('omekodinma Victoria', '08168818299'),
    ('Benedicta Onyema', '09117365805'),
    ('gift Eze', null),
    ('Goodness chukwuajah', '07041752149'),
    ('Joshua chibuenyim', '09068068385'),
    ('kelvin', null),
    ('Michelle', '09049291694'),
    ('Favour', '07019199742'),
    ('Chiwendu', '09167975892'),
    ('Daniel', '08120144461'),
    ('miracle', '07040035664'),
    ('Onyinye', null);

create temporary table im_restored(id uuid, full_name text) on commit drop;

with onsheet as (
  select distinct p.id
  from im_solo_sheet s
  join profiles p
    on (public.im_phone_key(s.phone) is not null
        and public.im_phone_key(s.phone) in (public.im_phone_key(p.phone),
                                             public.im_phone_key(p.whatsapp_number)))
    or public.im_name_set(s.full_name) = public.im_name_set(p.full_name)
    or public.im_name_key(s.full_name) = public.im_name_key(p.full_name)
    or (array_length(public.im_name_arr(s.full_name), 1) >= 2
        and array_length(public.im_name_arr(p.full_name), 1) >= 2
        and (public.im_name_arr(s.full_name) <@ public.im_name_arr(p.full_name)
             or public.im_name_arr(p.full_name) <@ public.im_name_arr(s.full_name)))
    or exists (
         select 1 from im_alias a
         where public.im_name_key(a.sheet_name) = public.im_name_key(s.full_name)
           and public.im_name_key(a.official_name) = public.im_name_key(p.full_name)
       )
)
insert into im_restored(id, full_name)
select p.id, p.full_name
from profiles p
where p.id in (select id from onsheet)
  and p.member_status = 'left';

update profiles set member_status = 'active'
where id in (select id from im_restored);

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'profiles' and column_name = 'access_revoked_at') then
    execute $q$
      update profiles
      set access_revoked_at = null, access_revoked_by = null, access_revoked_reason = null
      where id in (select id from im_restored)
    $q$;
  end if;
end $$;

-- ----------------------------------------------------------------------------
--  Step 2 — the unit itself.
-- ----------------------------------------------------------------------------
-- Who is primary somewhere else right now. A person has exactly one primary
-- unit, so putting them here takes them out of that one — which is reported
-- rather than happening quietly, because it changes who counts whom.
create temporary table im_moved(full_name text, from_unit text) on commit drop;

insert into im_moved(full_name, from_unit)
select p.full_name, s.name
from im_solo_sheet sh
join profiles p
  on (public.im_phone_key(sh.phone) is not null
      and public.im_phone_key(sh.phone) in (public.im_phone_key(p.phone),
                                            public.im_phone_key(p.whatsapp_number)))
  or public.im_name_set(sh.full_name) = public.im_name_set(p.full_name)
  or public.im_name_key(sh.full_name) = public.im_name_key(p.full_name)
  or exists (
       select 1 from im_alias a
       where public.im_name_key(a.sheet_name) = public.im_name_key(sh.full_name)
         and public.im_name_key(a.official_name) = public.im_name_key(p.full_name)
     )
join subunit_members sm on sm.user_id = p.id and sm.membership_type = 'primary'
join subunits s on s.id = sm.subunit_id
where public.im_name_key(s.name) <> public.im_name_key('Utility (Videography & Technical)');

-- ----------------------------------------------------------------------------
--  Utility (Videography & Technical)  (primary) — 29 names on the sheet
-- ----------------------------------------------------------------------------
create temporary table im_sheet_utility_videography_technical(full_name text, phone text) on commit drop;
insert into im_sheet_utility_videography_technical(full_name, phone) values
    ('divine oluwa', '08084477742'),
    ('Aniobi smiles', '08152878749'),
    ('Chibueze nwachukwu', '08146359618'),
    ('Chidibere success', '09119229230'),
    ('Ezenwa Emmanuel', '08023813695'),
    ('Ifeoma Nnam', '08086478211'),
    ('David Milagro', '09060694909'),
    ('Nathaniel Peter', '07087135592'),
    ('okereke goodness', '08117828223'),
    ('Oluchi Eze', '09031277384'),
    ('Pamela Orji', '07061669987'),
    ('precious Okechukwu', '07047146684'),
    ('Somto okafor', '09015589563'),
    ('Rhema ubakibie', '08166364341'),
    ('Samuel nwaigwe', '07044205365'),
    ('Sunday divine', '08112175408'),
    ('victor igattah', '09130254153'),
    ('omekodinma Victoria', '08168818299'),
    ('Benedicta Onyema', '09117365805'),
    ('gift Eze', null),
    ('Goodness chukwuajah', '07041752149'),
    ('Joshua chibuenyim', '09068068385'),
    ('kelvin', null),
    ('Michelle', '09049291694'),
    ('Favour', '07019199742'),
    ('Chiwendu', '09167975892'),
    ('Daniel', '08120144461'),
    ('miracle', '07040035664'),
    ('Onyinye', null);

create temporary table im_su_utility_videography_technical(id uuid) on commit drop;
insert into im_su_utility_videography_technical
select id from subunits where public.im_name_key(name) = public.im_name_key('Utility (Videography & Technical)');

do $$
begin
  if not exists (select 1 from im_su_utility_videography_technical) then
    raise exception 'No subunit named "Utility (Videography & Technical)" exists. Create it under Admin -> Subunits first.';
  end if;
end $$;

-- Resolve each sheet line to one account. An account can only be claimed once.
create temporary table im_hit_utility_videography_technical(listed_name text, user_id uuid) on commit drop;
-- Tier 0: a hand-checked spelling difference.
insert into im_hit_utility_videography_technical(listed_name, user_id)
select distinct s.full_name, p.id
from im_sheet_utility_videography_technical s
join im_alias a on public.im_name_key(a.sheet_name) = public.im_name_key(s.full_name)
join profiles p on public.im_name_key(p.full_name) = public.im_name_key(a.official_name)
where p.member_status <> 'left';

insert into im_hit_utility_videography_technical(listed_name, user_id)
select distinct s.full_name, p.id
from im_sheet_utility_videography_technical s
join profiles p
  on (public.im_phone_key(s.phone) is not null
      and public.im_phone_key(s.phone) in (public.im_phone_key(p.phone),
                                           public.im_phone_key(p.whatsapp_number)))
  or public.im_name_set(s.full_name) = public.im_name_set(p.full_name)
  or public.im_name_key(s.full_name) = public.im_name_key(p.full_name)
where p.member_status <> 'left';

-- Third tier: one name contained in the other ("Majesty Gift" inside
-- "Majesty Gift Chijindu"), and ONLY when exactly one account fits. A
-- shortened name that could be two people stays unmatched on purpose — that
-- is how "Agbo Amarachi Grace" is kept apart from "Agbo Amarachi Emmanuella".
insert into im_hit_utility_videography_technical(listed_name, user_id)
select t.full_name, t.only_id
from (
  select s.full_name,
         min(p.id::text)::uuid as only_id,
         count(distinct p.id)  as fits
  from im_sheet_utility_videography_technical s
  join profiles p
    on array_length(public.im_name_arr(s.full_name), 1) >= 2
   -- Both sides need two names. A one-word account ("Chiamaka") is contained
   -- in every sheet line that happens to use that name, which would make it a
   -- magnet claiming the wrong person.
   and array_length(public.im_name_arr(p.full_name), 1) >= 2
   and (public.im_name_arr(s.full_name) <@ public.im_name_arr(p.full_name)
        or public.im_name_arr(p.full_name) <@ public.im_name_arr(s.full_name))
  where p.member_status <> 'left'
    and not exists (select 1 from im_hit_utility_videography_technical h where h.listed_name = s.full_name)
    and p.id not in (select user_id from im_hit_utility_videography_technical)
  group by s.full_name
) t
where t.fits = 1;

create temporary table im_resolved_utility_videography_technical(user_id uuid primary key) on commit drop;
insert into im_resolved_utility_videography_technical
select user_id from im_hit_utility_videography_technical group by user_id;

insert into im_unmatched(unit, listed_name)
select 'Utility (Videography & Technical)', s.full_name
from im_sheet_utility_videography_technical s
where not exists (select 1 from im_hit_utility_videography_technical h where h.listed_name = s.full_name);

-- Take out anyone currently primary here who is not on the sheet.
with gone as (
  delete from subunit_members sm
  using im_su_utility_videography_technical su
  where sm.subunit_id = su.id
    and sm.membership_type = 'primary'
    and sm.user_id not in (select user_id from im_resolved_utility_videography_technical)
  returning 1
)
insert into im_report select 'Utility (Videography & Technical)', 'removed from unit', count(*) from gone;

-- A person has exactly one primary unit, so clear any primary elsewhere.
delete from subunit_members sm
where sm.membership_type = 'primary'
  and sm.user_id in (select user_id from im_resolved_utility_videography_technical)
  and sm.subunit_id <> (select id from im_su_utility_videography_technical);

-- Already in this unit as a secondary member: promote rather than duplicate.
with up as (
  update subunit_members sm
  set membership_type = 'primary'
  from im_su_utility_videography_technical su
  where sm.subunit_id = su.id
    and sm.user_id in (select user_id from im_resolved_utility_videography_technical)
    and sm.membership_type <> 'primary'
  returning 1
)
insert into im_report select 'Utility (Videography & Technical)', 'promoted to primary', count(*) from up;

with ins as (
  insert into subunit_members (user_id, subunit_id, membership_type)
  select r.user_id, su.id, 'primary'
  from im_resolved_utility_videography_technical r, im_su_utility_videography_technical su
  on conflict (subunit_id, user_id) do nothing
  returning 1
)
insert into im_report select 'Utility (Videography & Technical)', 'added as primary', count(*) from ins;

-- ----------------------------------------------------------------------------
--  RESULTS
-- ----------------------------------------------------------------------------
select full_name as put_back_because_they_are_in_this_unit from im_restored
order by full_name;

select distinct full_name as moved_here, from_unit as taken_out_of from im_moved
order by from_unit, full_name;

select unit, action, n from im_report order by unit, action;

select s.name as subunit,
       count(*) filter (where sm.membership_type = 'primary')   as primary_members,
       count(*) filter (where sm.membership_type = 'secondary') as secondary_members
from subunits s
left join subunit_members sm on sm.subunit_id = s.id
left join profiles p on p.id = sm.user_id and p.member_status <> 'left'
group by s.name
order by s.name;

-- Names on the sheet that matched nobody. Create these from the app
-- (Admin -> Members) so the login is made properly, then run this again.
select unit, listed_name as matched_nobody from im_unmatched order by unit, listed_name;

select count(*) filter (where member_status <> 'left') as active_accounts,
       count(*)                                        as total_rows
from profiles;

commit;
