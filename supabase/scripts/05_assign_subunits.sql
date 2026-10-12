-- ============================================================================
--  03_assign_subunits.sql  —  THIS CHANGES DATA.
-- ============================================================================
--  Run 00_helpers.sql first, and 02_remove_not_on_list.sql before this so the
--  sheets are matched against the people who are actually still members.
--
--  For each PRIMARY unit the membership is REPLACED by the sheet: everyone on
--  it becomes a primary member of that unit, and anyone currently primary
--  there who is not on the sheet is taken out of it. That is what turns
--  Photography from 48 people into the 21 on your list.
--
--  Video Editing is SECONDARY, so it sits alongside a person's primary unit
--  instead of replacing it.
--
--  Matching is phone first, then the same set of names, then the exact name.
--  A name that matches nobody is listed at the very end rather than guessed
--  at — those need doing by hand.
--
--  Everything runs in ONE transaction: if any part fails, nothing changes.
-- ============================================================================

begin;

create temporary table im_unmatched(unit text, listed_name text) on commit drop;
create temporary table im_report(unit text, action text, n int) on commit drop;

create temporary table im_alias(sheet_name text, official_name text) on commit drop;
-- Spellings that differ between the unit sheets and the members list. Each
-- pair was checked by hand and BOTH spellings are shown so you can verify them
-- at a glance. Nothing here is a guess by the computer.
insert into im_alias(sheet_name, official_name) values
  ('Ndudim Miracle',           'Ndudum Chidimma Miracle'),      -- Ndudim / Ndudum
  ('Iniwoke Joyce ogheneyole', 'Iniwoke Joy Ogheneyole'),        -- Joyce / Joy
  ('Ezeora Angel',             'Ezeora Evangel Oluomachi'),      -- Angel / Evangel
  ('Ezeora Angel Oluomachi',   'Ezeora Evangel Oluomachi'),
  ('Ikeme Ebube',              'Ikeme Ebubechukwu Daniel'),      -- Ebube / Ebubechukwu
  ('Philip Kamsi',             'Nwokolo Kamsiyochukwu Philip'),  -- Kamsi / Kamsiyochukwu
  ('Favour Mmesoma',           'Chinanu Favour Nmesoma'),        -- Mmesoma / Nmesoma
  -- Confirmed by the department: one person, not two sisters. The middle name
  -- and the phone number both differ between the lists, which is why this
  -- could not be worked out from the data alone.
  ('Agbo Amarachi Grace',      'Agbo Amarachi Emmanuella'),      -- Grace / Emmanuella
  ('Agbo Grace A',             'Agbo Amarachi Emmanuella'),
  -- Confirmed: one person who changed number.
  ('Owan Flourish',            'Owan Flourish Worma');

-- ----------------------------------------------------------------------------
--  Production  (primary) — 20 names on the sheet
-- ----------------------------------------------------------------------------
create temporary table im_sheet_production(full_name text, phone text) on commit drop;
insert into im_sheet_production(full_name, phone) values
    ('Nwokolo Kamsiyochukwu Philip', '09034420395'),
    ('Madukasi Godswill', '07069449149'),
    ('Chinanu Nmesoma Favour', '09136122587'),
    ('Ohiero Favour', '08084816728'),
    ('Agbo Amarachi Grace', '07049709807'),
    ('Chima Jasper', '09060432830'),
    ('Agu Chibueze Alex', '08136821764'),
    ('Onuh Godsgoodness Ikedi', '09023699384'),
    ('Austin Precious', '08087332771'),
    ('Joshua victor', '09161356392'),
    ('Ejinkonye Dennis', '07031179931'),
    ('Alioze Benita Zoe', '09078102805'),
    ('Ezedinachi Emmanuel', '08106973270'),
    ('Abugu Philip', '09139930882'),
    ('Owan Flourish', '09049146306'),
    ('Uche', null),
    ('Akachukwu', '09041455715'),
    ('Kosi', '08117478722'),
    ('Emmanuel', '07037526787'),
    ('Prince', '08133811815');

create temporary table im_su_production(id uuid) on commit drop;
insert into im_su_production
select id from subunits where public.im_name_key(name) = public.im_name_key('Production');

do $$
begin
  if not exists (select 1 from im_su_production) then
    raise exception 'No subunit named "Production" exists. Create it under Admin -> Subunits first.';
  end if;
end $$;

-- Resolve each sheet line to one account. An account can only be claimed once.
create temporary table im_hit_production(listed_name text, user_id uuid) on commit drop;
-- Tier 0: a hand-checked spelling difference.
insert into im_hit_production(listed_name, user_id)
select distinct s.full_name, p.id
from im_sheet_production s
join im_alias a on public.im_name_key(a.sheet_name) = public.im_name_key(s.full_name)
join profiles p on public.im_name_key(p.full_name) = public.im_name_key(a.official_name)
where p.member_status <> 'left';

insert into im_hit_production(listed_name, user_id)
select distinct s.full_name, p.id
from im_sheet_production s
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
insert into im_hit_production(listed_name, user_id)
select t.full_name, t.only_id
from (
  select s.full_name,
         min(p.id::text)::uuid as only_id,
         count(distinct p.id)  as fits
  from im_sheet_production s
  join profiles p
    on array_length(public.im_name_arr(s.full_name), 1) >= 2
   -- Both sides need two names. A one-word account ("Chiamaka") is contained
   -- in every sheet line that happens to use that name, which would make it a
   -- magnet claiming the wrong person.
   and array_length(public.im_name_arr(p.full_name), 1) >= 2
   and (public.im_name_arr(s.full_name) <@ public.im_name_arr(p.full_name)
        or public.im_name_arr(p.full_name) <@ public.im_name_arr(s.full_name))
  where p.member_status <> 'left'
    and not exists (select 1 from im_hit_production h where h.listed_name = s.full_name)
    and p.id not in (select user_id from im_hit_production)
  group by s.full_name
) t
where t.fits = 1;

create temporary table im_resolved_production(user_id uuid primary key) on commit drop;
insert into im_resolved_production
select user_id from im_hit_production group by user_id;

insert into im_unmatched(unit, listed_name)
select 'Production', s.full_name
from im_sheet_production s
where not exists (select 1 from im_hit_production h where h.listed_name = s.full_name);

-- Take out anyone currently primary here who is not on the sheet.
with gone as (
  delete from subunit_members sm
  using im_su_production su
  where sm.subunit_id = su.id
    and sm.membership_type = 'primary'
    and sm.user_id not in (select user_id from im_resolved_production)
  returning 1
)
insert into im_report select 'Production', 'removed from unit', count(*) from gone;

-- A person has exactly one primary unit, so clear any primary elsewhere.
delete from subunit_members sm
where sm.membership_type = 'primary'
  and sm.user_id in (select user_id from im_resolved_production)
  and sm.subunit_id <> (select id from im_su_production);

-- Already in this unit as a secondary member: promote rather than duplicate.
with up as (
  update subunit_members sm
  set membership_type = 'primary'
  from im_su_production su
  where sm.subunit_id = su.id
    and sm.user_id in (select user_id from im_resolved_production)
    and sm.membership_type <> 'primary'
  returning 1
)
insert into im_report select 'Production', 'promoted to primary', count(*) from up;

with ins as (
  insert into subunit_members (user_id, subunit_id, membership_type)
  select r.user_id, su.id, 'primary'
  from im_resolved_production r, im_su_production su
  on conflict (subunit_id, user_id) do nothing
  returning 1
)
insert into im_report select 'Production', 'added as primary', count(*) from ins;

-- ----------------------------------------------------------------------------
--  Photography  (primary) — 21 names on the sheet
-- ----------------------------------------------------------------------------
create temporary table im_sheet_photography(full_name text, phone text) on commit drop;
insert into im_sheet_photography(full_name, phone) values
    ('chinenyenwa victory', '8166901443'),
    ('Orji Chiugo Sombodi', '7032680219'),
    ('Sunday Emmanuel', '9112424977'),
    ('victor sam', '9162645815'),
    ('Christian Okonkwo', '9011532264'),
    ('Igolo Divine Chiziterem', '8144764504'),
    ('Ikeme Ebube Daniel', '7048457380'),
    ('OGBONNA Precious C.', '8155113431'),
    ('Emeka Goodness Nzubechi', '7048869525'),
    ('Henry Nwankwo', '7032736919'),
    ('Jibulu Goodness', '9045391548'),
    ('Obinna God''s will', '8024629884'),
    ('samuel', '7072496518'),
    ('udokwu Harrison Ebube', '9160570525'),
    ('Offor Akachi Patrick', '9162477061'),
    ('Okoh Chimdindu Sophie', '8076772318'),
    ('Moses', '2347041118511'),
    ('Charles', '8101115730'),
    ('Abundance', '7066990490'),
    ('Victor', '2347070294367'),
    ('Kenechukwu', '2348050878887');

create temporary table im_su_photography(id uuid) on commit drop;
insert into im_su_photography
select id from subunits where public.im_name_key(name) = public.im_name_key('Photography');

do $$
begin
  if not exists (select 1 from im_su_photography) then
    raise exception 'No subunit named "Photography" exists. Create it under Admin -> Subunits first.';
  end if;
end $$;

-- Resolve each sheet line to one account. An account can only be claimed once.
create temporary table im_hit_photography(listed_name text, user_id uuid) on commit drop;
-- Tier 0: a hand-checked spelling difference.
insert into im_hit_photography(listed_name, user_id)
select distinct s.full_name, p.id
from im_sheet_photography s
join im_alias a on public.im_name_key(a.sheet_name) = public.im_name_key(s.full_name)
join profiles p on public.im_name_key(p.full_name) = public.im_name_key(a.official_name)
where p.member_status <> 'left';

insert into im_hit_photography(listed_name, user_id)
select distinct s.full_name, p.id
from im_sheet_photography s
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
insert into im_hit_photography(listed_name, user_id)
select t.full_name, t.only_id
from (
  select s.full_name,
         min(p.id::text)::uuid as only_id,
         count(distinct p.id)  as fits
  from im_sheet_photography s
  join profiles p
    on array_length(public.im_name_arr(s.full_name), 1) >= 2
   -- Both sides need two names. A one-word account ("Chiamaka") is contained
   -- in every sheet line that happens to use that name, which would make it a
   -- magnet claiming the wrong person.
   and array_length(public.im_name_arr(p.full_name), 1) >= 2
   and (public.im_name_arr(s.full_name) <@ public.im_name_arr(p.full_name)
        or public.im_name_arr(p.full_name) <@ public.im_name_arr(s.full_name))
  where p.member_status <> 'left'
    and not exists (select 1 from im_hit_photography h where h.listed_name = s.full_name)
    and p.id not in (select user_id from im_hit_photography)
  group by s.full_name
) t
where t.fits = 1;

create temporary table im_resolved_photography(user_id uuid primary key) on commit drop;
insert into im_resolved_photography
select user_id from im_hit_photography group by user_id;

insert into im_unmatched(unit, listed_name)
select 'Photography', s.full_name
from im_sheet_photography s
where not exists (select 1 from im_hit_photography h where h.listed_name = s.full_name);

-- Take out anyone currently primary here who is not on the sheet.
with gone as (
  delete from subunit_members sm
  using im_su_photography su
  where sm.subunit_id = su.id
    and sm.membership_type = 'primary'
    and sm.user_id not in (select user_id from im_resolved_photography)
  returning 1
)
insert into im_report select 'Photography', 'removed from unit', count(*) from gone;

-- A person has exactly one primary unit, so clear any primary elsewhere.
delete from subunit_members sm
where sm.membership_type = 'primary'
  and sm.user_id in (select user_id from im_resolved_photography)
  and sm.subunit_id <> (select id from im_su_photography);

-- Already in this unit as a secondary member: promote rather than duplicate.
with up as (
  update subunit_members sm
  set membership_type = 'primary'
  from im_su_photography su
  where sm.subunit_id = su.id
    and sm.user_id in (select user_id from im_resolved_photography)
    and sm.membership_type <> 'primary'
  returning 1
)
insert into im_report select 'Photography', 'promoted to primary', count(*) from up;

with ins as (
  insert into subunit_members (user_id, subunit_id, membership_type)
  select r.user_id, su.id, 'primary'
  from im_resolved_photography r, im_su_photography su
  on conflict (subunit_id, user_id) do nothing
  returning 1
)
insert into im_report select 'Photography', 'added as primary', count(*) from ins;

-- ----------------------------------------------------------------------------
--  Projection  (primary) — 27 names on the sheet
-- ----------------------------------------------------------------------------
create temporary table im_sheet_projection(full_name text, phone text) on commit drop;
insert into im_sheet_projection(full_name, phone) values
    ('Obichukwu Charis', null),
    ('Obichukwu Splendour', null),
    ('Godwin Favour Onyiyechi', null),
    ('Kalu Victoria', null),
    ('Okoroafor Iheoma Precious', null),
    ('Esther Emmanuel', null),
    ('Chidube Kamtochukwu Blossom', null),
    ('Joseph Jennifer', null),
    ('Ibeneme Precious Gozie', null),
    ('Ndudim Miracle', null),
    ('Opara Chidumebi', null),
    ('God''s Child Precious Munachiso', null),
    ('Okoroafor Ogechukwu', null),
    ('Osuji Miracle Amarachukwu', null),
    ('Ani Chisom Miracle', null),
    ('Nnamani Emmanuel Chidera', null),
    ('Prevail Ugonna Peter', null),
    ('Isuelu Praise Chidimma', null),
    ('Iniwoke Joyce ogheneyole', null),
    ('Onwe ogechukwu', null),
    ('Majesty Gift Chijindu', null),
    ('Akandu Oluchukwu Ifunanya', null),
    ('Alex Chinoso', null),
    ('Amarachi Igbana', null),
    ('Nwachukwu Favour Obinna', null),
    ('Udeoma Chidera Precious', null),
    ('Aja-aki Chioma', null);

create temporary table im_su_projection(id uuid) on commit drop;
insert into im_su_projection
select id from subunits where public.im_name_key(name) = public.im_name_key('Projection');

do $$
begin
  if not exists (select 1 from im_su_projection) then
    raise exception 'No subunit named "Projection" exists. Create it under Admin -> Subunits first.';
  end if;
end $$;

-- Resolve each sheet line to one account. An account can only be claimed once.
create temporary table im_hit_projection(listed_name text, user_id uuid) on commit drop;
-- Tier 0: a hand-checked spelling difference.
insert into im_hit_projection(listed_name, user_id)
select distinct s.full_name, p.id
from im_sheet_projection s
join im_alias a on public.im_name_key(a.sheet_name) = public.im_name_key(s.full_name)
join profiles p on public.im_name_key(p.full_name) = public.im_name_key(a.official_name)
where p.member_status <> 'left';

insert into im_hit_projection(listed_name, user_id)
select distinct s.full_name, p.id
from im_sheet_projection s
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
insert into im_hit_projection(listed_name, user_id)
select t.full_name, t.only_id
from (
  select s.full_name,
         min(p.id::text)::uuid as only_id,
         count(distinct p.id)  as fits
  from im_sheet_projection s
  join profiles p
    on array_length(public.im_name_arr(s.full_name), 1) >= 2
   -- Both sides need two names. A one-word account ("Chiamaka") is contained
   -- in every sheet line that happens to use that name, which would make it a
   -- magnet claiming the wrong person.
   and array_length(public.im_name_arr(p.full_name), 1) >= 2
   and (public.im_name_arr(s.full_name) <@ public.im_name_arr(p.full_name)
        or public.im_name_arr(p.full_name) <@ public.im_name_arr(s.full_name))
  where p.member_status <> 'left'
    and not exists (select 1 from im_hit_projection h where h.listed_name = s.full_name)
    and p.id not in (select user_id from im_hit_projection)
  group by s.full_name
) t
where t.fits = 1;

create temporary table im_resolved_projection(user_id uuid primary key) on commit drop;
insert into im_resolved_projection
select user_id from im_hit_projection group by user_id;

insert into im_unmatched(unit, listed_name)
select 'Projection', s.full_name
from im_sheet_projection s
where not exists (select 1 from im_hit_projection h where h.listed_name = s.full_name);

-- Take out anyone currently primary here who is not on the sheet.
with gone as (
  delete from subunit_members sm
  using im_su_projection su
  where sm.subunit_id = su.id
    and sm.membership_type = 'primary'
    and sm.user_id not in (select user_id from im_resolved_projection)
  returning 1
)
insert into im_report select 'Projection', 'removed from unit', count(*) from gone;

-- A person has exactly one primary unit, so clear any primary elsewhere.
delete from subunit_members sm
where sm.membership_type = 'primary'
  and sm.user_id in (select user_id from im_resolved_projection)
  and sm.subunit_id <> (select id from im_su_projection);

-- Already in this unit as a secondary member: promote rather than duplicate.
with up as (
  update subunit_members sm
  set membership_type = 'primary'
  from im_su_projection su
  where sm.subunit_id = su.id
    and sm.user_id in (select user_id from im_resolved_projection)
    and sm.membership_type <> 'primary'
  returning 1
)
insert into im_report select 'Projection', 'promoted to primary', count(*) from up;

with ins as (
  insert into subunit_members (user_id, subunit_id, membership_type)
  select r.user_id, su.id, 'primary'
  from im_resolved_projection r, im_su_projection su
  on conflict (subunit_id, user_id) do nothing
  returning 1
)
insert into im_report select 'Projection', 'added as primary', count(*) from ins;

-- ----------------------------------------------------------------------------
--  Video Editing  (secondary) — 24 names on the sheet
-- ----------------------------------------------------------------------------
create temporary table im_sheet_video_editing(full_name text, phone text) on commit drop;
insert into im_sheet_video_editing(full_name, phone) values
    ('Ejinkonye Dennis', null),
    ('Majesty Gift', null),
    ('Aliozor Lilian', null),
    ('Okoh Chimdindu', null),
    ('Favour ohiero', null),
    ('Kalu Victoria', null),
    ('Isuelu Praise', null),
    ('Agbo Grace A', null),
    ('Success Eziashi', null),
    ('Vanessa Chioma', null),
    ('Philip Kamsi', null),
    ('Goodness (Splendid)', null),
    ('Ikeme Ebube', null),
    ('Ezenwa Emmanuel', null),
    ('Udeoma chidera', null),
    ('Madukasi Godswill', null),
    ('Ezeora Angel', null),
    ('Okechukwu precious', null),
    ('Eze Oluchi', null),
    ('Ogbonna Precious', null),
    ('Chinenye', null),
    ('Divine Oluwa', null),
    ('Favour Mmesoma', null),
    ('Agu Chibueze', null);

create temporary table im_su_video_editing(id uuid) on commit drop;
insert into im_su_video_editing
select id from subunits where public.im_name_key(name) = public.im_name_key('Video Editing');

do $$
begin
  if not exists (select 1 from im_su_video_editing) then
    raise exception 'No subunit named "Video Editing" exists. Create it under Admin -> Subunits first.';
  end if;
end $$;

-- Resolve each sheet line to one account. An account can only be claimed once.
create temporary table im_hit_video_editing(listed_name text, user_id uuid) on commit drop;
-- Tier 0: a hand-checked spelling difference.
insert into im_hit_video_editing(listed_name, user_id)
select distinct s.full_name, p.id
from im_sheet_video_editing s
join im_alias a on public.im_name_key(a.sheet_name) = public.im_name_key(s.full_name)
join profiles p on public.im_name_key(p.full_name) = public.im_name_key(a.official_name)
where p.member_status <> 'left';

insert into im_hit_video_editing(listed_name, user_id)
select distinct s.full_name, p.id
from im_sheet_video_editing s
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
insert into im_hit_video_editing(listed_name, user_id)
select t.full_name, t.only_id
from (
  select s.full_name,
         min(p.id::text)::uuid as only_id,
         count(distinct p.id)  as fits
  from im_sheet_video_editing s
  join profiles p
    on array_length(public.im_name_arr(s.full_name), 1) >= 2
   -- Both sides need two names. A one-word account ("Chiamaka") is contained
   -- in every sheet line that happens to use that name, which would make it a
   -- magnet claiming the wrong person.
   and array_length(public.im_name_arr(p.full_name), 1) >= 2
   and (public.im_name_arr(s.full_name) <@ public.im_name_arr(p.full_name)
        or public.im_name_arr(p.full_name) <@ public.im_name_arr(s.full_name))
  where p.member_status <> 'left'
    and not exists (select 1 from im_hit_video_editing h where h.listed_name = s.full_name)
    and p.id not in (select user_id from im_hit_video_editing)
  group by s.full_name
) t
where t.fits = 1;

create temporary table im_resolved_video_editing(user_id uuid primary key) on commit drop;
insert into im_resolved_video_editing
select user_id from im_hit_video_editing group by user_id;

insert into im_unmatched(unit, listed_name)
select 'Video Editing', s.full_name
from im_sheet_video_editing s
where not exists (select 1 from im_hit_video_editing h where h.listed_name = s.full_name);

-- Take out anyone currently in this unit who is not on the sheet — primary
-- rows included. This is a SECONDARY unit, so nobody should be primary in it,
-- but the live data had people sitting there as primary, and only cleaning
-- secondary rows left them behind. They are also the only people the unit's
-- attendance list would show, since attendance is reported by primary unit.
with gone as (
  delete from subunit_members sm
  using im_su_video_editing su
  where sm.subunit_id = su.id
    and sm.user_id not in (select user_id from im_resolved_video_editing)
  returning 1
)
insert into im_report select 'Video Editing', 'removed from unit', count(*) from gone;

-- On the sheet, but recorded as primary in this secondary unit. Demote to
-- secondary and report them: they now have no primary unit at all, so they
-- need one before they appear on any attendance list.
with demoted as (
  update subunit_members sm
  set membership_type = 'secondary'
  from im_su_video_editing su
  where sm.subunit_id = su.id
    and sm.membership_type = 'primary'
    and sm.user_id in (select user_id from im_resolved_video_editing)
  returning 1
)
insert into im_report select 'Video Editing', 'demoted from primary (NEEDS A PRIMARY UNIT)', count(*) from demoted;

-- Add as secondary, skipping anyone already at the four-subunit cap so the
-- cap trigger cannot abort the whole transaction.
with ins as (
  insert into subunit_members (user_id, subunit_id, membership_type)
  select r.user_id, su.id, 'secondary'
  from im_resolved_video_editing r, im_su_video_editing su
  where (select count(*) from subunit_members x where x.user_id = r.user_id) < 4
  on conflict (subunit_id, user_id) do nothing
  returning 1
)
insert into im_report select 'Video Editing', 'added as secondary', count(*) from ins;

-- ----------------------------------------------------------------------------
--  Social Media  (primary) — 20 names on the sheet
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
    ('Nwachukwu Chibueze', null),
    ('Eze Chidiebube Ihuoma', null),
    ('Abanokwu Bethel Chielotam', null),
    ('Ugochukwu Christopher', null),
    ('Ikechukwu Success', null),
    ('Ugochi', null),
    ('Vera Chiamaka', null),
    ('Destiny', null),
    ('Cynthia', null);

create temporary table im_su_social_media(id uuid) on commit drop;
insert into im_su_social_media
select id from subunits where public.im_name_key(name) = public.im_name_key('Social Media');

do $$
begin
  if not exists (select 1 from im_su_social_media) then
    raise exception 'No subunit named "Social Media" exists. Create it under Admin -> Subunits first.';
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

-- ============================================================================
--  RESULTS
-- ============================================================================
select unit, action, n from im_report order by unit, action;

-- How many primary members each unit now has.
select s.name as subunit,
       count(*) filter (where sm.membership_type = 'primary')   as primary_members,
       count(*) filter (where sm.membership_type = 'secondary') as secondary_members
from subunits s
left join subunit_members sm on sm.subunit_id = s.id
left join profiles p on p.id = sm.user_id and p.member_status <> 'left'
group by s.name
order by s.name;

-- Names on a sheet that matched nobody. These need doing by hand.
select unit, listed_name as matched_nobody from im_unmatched order by unit, listed_name;

commit;
