-- ============================================================================
--  07_keep_subunit_people.sql  —  THIS CHANGES DATA.
-- ============================================================================
--  Run 00_helpers.sql first.
--
--  The rule the department actually wants: keep anyone who is on the official
--  members list OR on any subunit sheet. Only people on NEITHER are removed.
--
--  04_remove_not_on_list.sql judged on the members list alone, so it marked
--  some current subunit members as 'left'. This puts those people back, and
--  then tells you which sheet names still have no account at all.
--
--  Safe to re-run.
-- ============================================================================

begin;


-- The same hand-checked spelling pairs 05_assign_subunits.sql uses. Without
-- them this script reports people as having "no account" when they already
-- exist under their official spelling — and creating them would make a
-- duplicate of a real member.
create temporary table im_alias(sheet_name text, official_name text) on commit drop;
insert into im_alias(sheet_name, official_name) values
  ('Ndudim Miracle',           'Ndudum Chidimma Miracle'),
  ('Iniwoke Joyce ogheneyole', 'Iniwoke Joy Ogheneyole'),
  ('Ezeora Angel',             'Ezeora Evangel Oluomachi'),
  ('Ezeora Angel Oluomachi',   'Ezeora Evangel Oluomachi'),
  ('Ikeme Ebube',              'Ikeme Ebubechukwu Daniel'),
  ('Ikeme Ebube Daniel',       'Ikeme Ebubechukwu Daniel'),
  ('Philip Kamsi',             'Nwokolo Kamsiyochukwu Philip'),
  ('Favour Mmesoma',           'Chinanu Favour Nmesoma'),
  ('Agbo Amarachi Grace',      'Agbo Amarachi Emmanuella'),
  ('Agbo Grace A',             'Agbo Amarachi Emmanuella'),
  ('Owan Flourish',            'Owan Flourish Worma'),
  ('omekodinma Victoria',      'Victoria Omekaodinma'),
  ('kelvin',                   'Chika Chukwuelokalum Benedict');

create temporary table im_sheet_all(full_name text, phone text) on commit drop;
insert into im_sheet_all(full_name, phone) values
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
    ('Prince', '08133811815'),
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
    ('Kenechukwu', '2348050878887'),
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
    ('Aja-aki Chioma', null),
    ('Majesty Gift', null),
    ('Aliozor Lilian', null),
    ('Okoh Chimdindu', null),
    ('Isuelu Praise', null),
    ('Agbo Grace A', null),
    ('Success Eziashi', null),
    ('Vanessa Chioma', null),
    ('Philip Kamsi', null),
    ('Goodness (Splendid)', null),
    ('Ikeme Ebube', null),
    ('Ezenwa Emmanuel', null),
    ('Udeoma chidera', null),
    ('Ezeora Angel', null),
    ('Okechukwu precious', null),
    ('Eze Oluchi', null),
    ('Ogbonna Precious', null),
    ('Chinenye', null),
    ('Divine Oluwa', null),
    ('Favour Mmesoma', null),
    ('Agu Chibueze', null),
    -- Social Media. James Chiamaka is left out on purpose: the sheet marks
    -- him withdrawn, so he is not put back.
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
    ('Cynthia', null),
    -- Technical. Both unusual numbers were explained by the department:
    -- kelvin IS Chika Chukwuelokalum Benedict (see the pair above), and
    -- gift Eze's number is Cameroonian, not a malformed Nigerian one.
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
    ('gift Eze', '070676502264'),
    ('Goodness chukwuajah', '07041752149'),
    ('Joshua chibuenyim', '09068068385'),
    ('kelvin', '07088980666'),
    ('Michelle', '09049291694'),
    ('Favour', '07019199742'),
    ('Chiwendu', '09167975892'),
    ('Daniel', '08120144461'),
    ('miracle', '07040035664'),
    ('Onyinye', null);

-- Put back anyone on a subunit sheet who was removed.
create temporary table im_restored(id uuid, full_name text) on commit drop;

with onsheet as (
  select distinct p.id
  from im_sheet_all s
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
--  RESULTS
-- ----------------------------------------------------------------------------
select full_name as put_back_because_they_are_in_a_subunit from im_restored order by full_name;

select count(*) filter (where member_status <> 'left') as active_accounts,
       count(*) filter (where member_status = 'left')  as removed_accounts
from profiles;

-- Sheet names with no account at all. These are the only people still missing;
-- create them from the app (Admin -> Members list) so the login is made
-- properly, then re-run 05_assign_subunits.sql.
select s.full_name as no_account_yet, coalesce(s.phone, '(no phone)') as phone
from im_sheet_all s
where not exists (
  select 1 from profiles p
  where (public.im_phone_key(s.phone) is not null
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
order by s.full_name;

commit;
