-- ============================================================================
--  08_social_media.sql  —  THIS CHANGES DATA.
-- ============================================================================
--  Run 00_helpers.sql first. Nothing else is needed: this script is complete
--  on its own and safe to run more than once.
--
--  It does two things for the 19 names on the Social Media sheet:
--
--    1. Puts back anyone who was marked 'left' by 04_remove_not_on_list.sql.
--       They are current members of a subunit, so they stay — the same rule
--       07_keep_subunit_people.sql applies to the other units.
--    2. Makes them PRIMARY members of Social Media, and takes out anyone
--       currently primary there who is not on the sheet.
--
--  James Chiamaka is deliberately NOT here. The sheet marks him withdrawn
--  ("has another church"), so he is not put back and not added to the unit.
--
--  Abanokwu Bethel Chielotam carries no phone number below on purpose: the
--  sheet's "+23491230605" is too short to be a Nigerian number, and matching
--  on a truncated number could claim somebody else's account. The name matches
--  the members list exactly, which is enough.
--
--  Everything runs in ONE transaction: if any part fails, nothing changes.
-- ============================================================================

begin;

create temporary table im_unmatched(unit text, listed_name text) on commit drop;
create temporary table im_report(unit text, action text, n int) on commit drop;

create temporary table im_alias(sheet_name text, official_name text) on commit drop;
-- Left empty: every name on this sheet matches the members list as
-- written. The table exists because the matching block below joins it.

-- ----------------------------------------------------------------------------
--  Step 1 — put back anyone on this sheet who was removed.
-- ----------------------------------------------------------------------------
create temporary table im_solo_sheet(full_name text, phone text) on commit drop;
insert into im_solo_sheet(full_name, phone) values
    ('Ezeora Evangel Oluomachi', '09018149235'),
    ('Ibeabuchi Adanna', '07068960169'),
    ('Izuegbulam Chinwe Blessing', '09130376636'),
    ('Success Eziashi Ebubechukwu', '08101261442'),
    ('Uzoechi Deborah Chiamaka', '08112288230'),
    ('Okechukwu chidimma', '07080598886'),
    ('Ezechi Chinwe', null),
    ('Ezenwosu Chioma Vanessa', '08135188825'),
    ('Onwukeme zara', '08146450684'),
    ('Metu Amarachim', '08060283236'),
    ('Agu Vitalis Chukwuemerie', '07016639391'),
    ('Eze Chidiebube Ihuoma', null),
    ('Abanokwu Bethel Chielotam', null),
    ('Ugochukwu Christopher', null),
    ('Ikechukwu Success', null),
    ('Ugochi', null),
    ('Vera Chiamaka', null),
    ('Destiny', null),
    ('Cynthia', null);

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
where public.im_name_key(s.name) <> public.im_name_key('Social Media');

-- ----------------------------------------------------------------------------
--  Social Media  (primary) — 19 names on the sheet
-- ----------------------------------------------------------------------------
create temporary table im_sheet_social_media(full_name text, phone text) on commit drop;
insert into im_sheet_social_media(full_name, phone) values
    ('Ezeora Evangel Oluomachi', '09018149235'),
    ('Ibeabuchi Adanna', '07068960169'),
    ('Izuegbulam Chinwe Blessing', '09130376636'),
    ('Success Eziashi Ebubechukwu', '08101261442'),
    ('Uzoechi Deborah Chiamaka', '08112288230'),
    ('Okechukwu chidimma', '07080598886'),
    ('Ezechi Chinwe', null),
    ('Ezenwosu Chioma Vanessa', '08135188825'),
    ('Onwukeme zara', '08146450684'),
    ('Metu Amarachim', '08060283236'),
    ('Agu Vitalis Chukwuemerie', '07016639391'),
    ('Eze Chidiebube Ihuoma', null),
    ('Abanokwu Bethel Chielotam', null),
    ('Ugochukwu Christopher', null),
    ('Ikechukwu Success', null),
    ('Ugochi', null),
    ('Vera Chiamaka', null),
    ('Destiny', null),
    ('Cynthia', null);

create temporary table im_su_social_media(id uuid) on commit drop;
-- The slug first, then the name, then any name this unit used to go by, so a
-- rename does not quietly turn this section into a no-op.
insert into im_su_social_media
select id from subunits
where slug = 'social-media'
   or public.im_name_key(name) = any (array[public.im_name_key('Social Media')]);

do $$
begin
  if not exists (select 1 from im_su_social_media) then
    raise exception 'No subunit named "Social Media" exists. Create it under Admin -> Subunits first.';
  end if;
  -- Two matching rows would mean a duplicate subunit, and the statements below
  -- read this as a single id. Stop rather than pick one.
  if (select count(*) from im_su_social_media) > 1 then
    raise exception 'More than one subunit matches "Social Media". Merge them under Admin -> Subunits first.';
  end if;
end $$;

-- Resolve each sheet line to one account. An account can only be claimed once.
create temporary table im_hit_social_media(listed_name text, user_id uuid) on commit drop;
-- Tier 0: a hand-checked spelling difference.
insert into im_hit_social_media(listed_name, user_id)
select distinct s.full_name, p.id
from im_sheet_social_media s
join im_alias a on public.im_name_key(a.sheet_name) = public.im_name_key(s.full_name)
join profiles p on public.im_name_key(p.full_name) = public.im_name_key(a.official_name)
where p.member_status <> 'left';

insert into im_hit_social_media(listed_name, user_id)
select distinct s.full_name, p.id
from im_sheet_social_media s
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
insert into im_hit_social_media(listed_name, user_id)
select t.full_name, t.only_id
from (
  select s.full_name,
         min(p.id::text)::uuid as only_id,
         count(distinct p.id)  as fits
  from im_sheet_social_media s
  join profiles p
    on array_length(public.im_name_arr(s.full_name), 1) >= 2
   -- Both sides need two names. A one-word account ("Chiamaka") is contained
   -- in every sheet line that happens to use that name, which would make it a
   -- magnet claiming the wrong person.
   and array_length(public.im_name_arr(p.full_name), 1) >= 2
   and (public.im_name_arr(s.full_name) <@ public.im_name_arr(p.full_name)
        or public.im_name_arr(p.full_name) <@ public.im_name_arr(s.full_name))
  where p.member_status <> 'left'
    and not exists (select 1 from im_hit_social_media h where h.listed_name = s.full_name)
    and p.id not in (select user_id from im_hit_social_media)
  group by s.full_name
) t
where t.fits = 1;

create temporary table im_resolved_social_media(user_id uuid primary key) on commit drop;
insert into im_resolved_social_media
select user_id from im_hit_social_media group by user_id;

insert into im_unmatched(unit, listed_name)
select 'Social Media', s.full_name
from im_sheet_social_media s
where not exists (select 1 from im_hit_social_media h where h.listed_name = s.full_name);

-- Take out anyone currently primary here who is not on the sheet.
with gone as (
  delete from subunit_members sm
  using im_su_social_media su
  where sm.subunit_id = su.id
    and sm.membership_type = 'primary'
    and sm.user_id not in (select user_id from im_resolved_social_media)
  returning 1
)
insert into im_report select 'Social Media', 'removed from unit', count(*) from gone;

-- A person has exactly one primary unit, so clear any primary elsewhere.
delete from subunit_members sm
where sm.membership_type = 'primary'
  and sm.user_id in (select user_id from im_resolved_social_media)
  and sm.subunit_id <> (select id from im_su_social_media);

-- Already in this unit as a secondary member: promote rather than duplicate.
with up as (
  update subunit_members sm
  set membership_type = 'primary'
  from im_su_social_media su
  where sm.subunit_id = su.id
    and sm.user_id in (select user_id from im_resolved_social_media)
    and sm.membership_type <> 'primary'
  returning 1
)
insert into im_report select 'Social Media', 'promoted to primary', count(*) from up;

with ins as (
  insert into subunit_members (user_id, subunit_id, membership_type)
  select r.user_id, su.id, 'primary'
  from im_resolved_social_media r, im_su_social_media su
  on conflict (subunit_id, user_id) do nothing
  returning 1
)
insert into im_report select 'Social Media', 'added as primary', count(*) from ins;

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
