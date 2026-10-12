-- ============================================================================
--  04_remove_not_on_list.sql  —  THIS CHANGES DATA.
-- ============================================================================
--  Run 00_helpers.sql first, and read 03_preview.sql output before this.
--
--  Everyone NOT on the official list is marked 'left', which takes them off
--  every roster, every attendance list and every future report immediately.
--  Nothing is deleted, so past reports still read correctly and this can be
--  undone (see 06_undo.sql).
--
--  Accounts holding a role (secretary, welfare, leader, admin) are left alone
--  by this script on purpose — removing your own staff by accident is worse
--  than one extra active account. Deal with those by name afterwards.
-- ============================================================================

begin;

with official(full_name, phone) as (
    values
      ('Agbo Amarachi Emmanuella', '9022035639'),
      ('Agu Chibueze Alex', '8136821764'),
      ('Aja-Aki Chioma Nwannediya', '9165407939'),
      ('Alozie Benita', '9078102805'),
      ('Aniekan Israel', '7048083756'),
      ('Chidube Kamtochukwu Blossom', '9137499839'),
      ('Chika Chukwuelokalum Benedict', '7088980666'),
      ('CHIMA JASPER', '9060432830'),
      ('Chisom Precious', '9018678849'),
      ('Ejinkonye Dennis Chimzalum', '7031179931'),
      ('Emeka Goodness Nzubechi', '7065829586'),
      ('Esther Emmanuel', '8076877763'),
      ('Ezedinachi Emmanuel Chidubem', '1806973270'),
      ('Ezeora Evangel Oluomachi', '9018149235'),
      ('Ibeabuchi Adanna', '7068960169'),
      ('Igolo Divine Chiziterem', '8144764504'),
      ('Ikeme Ebubechukwu Daniel', '7048457380'),
      ('Izuegbulam Chinwe Blessing', '9130376636'),
      ('Jibulu Nmesoma Goodness', '9045391548'),
      ('Joshua Chibuenyim', '9068068385'),
      ('Kalu Victoria', '9153203880'),
      ('Madukasi Godswill Ebubechukwu', '7069449149'),
      ('Mameme Obinna God''swill', '8024629884'),
      ('NDUDUM CHIDIMMA MIRACLE', '9131422290'),
      ('Nnam Ifeoma', '8086478211'),
      ('Nwachukwu Favour Obinna', '9018717034'),
      ('Nwaigwe Samuel', '7044205365'),
      ('Nwani Chinaza Loveth', '8128952543'),
      ('Offor Akachi', '9162477061'),
      ('OGBONNA PRECIOUS CHUKWUASOKAM', '8155113431'),
      ('Okafor Somtochukwu', '9015589563'),
      ('Okechukwu Precious Chidera', '7047146684'),
      ('Okereke Nzubechukwu Goodness', '8117828223'),
      ('Okoroafor Iheoma Precious', '9040462455'),
      ('Opara Chidumebi Elisheva', '7075061412'),
      ('Oriaku Chidera', '7043908371'),
      ('ORJI PAMELA MMERICHUKWU', '7061669987'),
      ('Owan Flourish Worma', '9160781869'),
      ('Peter Nathaniel', '7087135592'),
      ('Success Eziashi Ebubechukwu', '8101261442'),
      ('Udeoma Chidera', '9032055636'),
      ('Ugochukwu Christopher Kosisochukwu', '9035504313'),
      ('Uzoechi Deborah Chiamaka', '8112288230'),
      ('Ezenwa Chukwubueze Emmanuel', '8023813695'),
      ('Jennifer Joseph', '9066436106'),
      ('Eze Miracle Oluchi', null),
      ('Ani Chisom Miracle', '8100318827'),
      ('Anidobe Godswill', '9015498900'),
      ('Chidiebere Success Ugochukwu', '9119229230'),
      ('Chinanu Favour Nmesoma', '9136122587'),
      ('Chinedu Chidumebi', '9167975892'),
      ('Egbe Joshua Oregbe', '8082400540'),
      ('Henry Nwankwo', '7032736919'),
      ('Owan Flourish', null),
      ('Ikechukwu Success Chidubem', '8064458872'),
      ('Nwabogwu Precious', null),
      ('Nnamani Emmanuel Chidera', '7072111293'),
      ('Nwachukwu Chibueze', '8146359618'),
      ('Godwin Favour', null),
      ('Victoria Omekaodinma', null),
      ('Nwokolo Kamsiyochukwu Philip', '9034420395'),
      ('Nwonyia Chiemelie', '8030443678'),
      ('Nworie Nneoma', '8062805318'),
      ('Okechukwu Chidimma', '7080598886'),
      ('OKOH CHIMDINDU SOPHIE', '8076772318'),
      ('ONYEMA BENEDICTA EZINNE', '9117365805'),
      ('Osuji Miracle Amarachukwu', '9025508510'),
      ('Sunday Chinemerem Emmanuel', '8106313516'),
      ('Uchenna Divine Chisom', '7071145821'),
      ('Udokwu Harry Ebube', '9160570525'),
      ('Igattah Victor', null),
      ('Majesty Gift Chijindu', '7075221762'),
      ('Ezenwosu Chioma Vanessa', '8135188825'),
      ('Prevail Ugonna Peter', '9114125622'),
      ('Victor Sam', null),
      ('ISUELU PRAISE', '7078771457'),
      ('Onwe Ogechukwu', '9065316872'),
      ('Eze Chidiebube Ihuoma', '9071213403'),
      ('Onuh Godsgoodness Ikedi', '9023699384'),
      ('Perfection Reward', '2348123320439'),
      ('Onwukeme Zara', '8146450684'),
      ('Metu Amarachim', '8060283236'),
      ('Ubakibie Rhema', '8166364341'),
      ('Ikebude Melvin Chinaemelem', '8103715458'),
      ('Agu Vitalis Chukwuemerie', '7016639391'),
      ('Ndubueze Chinenyenwa Victory', '8166901443'),
      ('Aniobi Smiles', '8152878749'),
      ('Abanokwu Bethel Chielotam', '2349123060528'),
      ('Iniwoke Joy Ogheneyole', '8164200437'),
      ('Onoh Charles', '8101115730'),
      ('Goodness Chukwuajah', '7041752149'),
      ('Sunday Divine Edache', '8112175408'),
      ('Ezeamatu Chigozirim Gift', '7012739748'),
      ('Ikechukwu Goodness Chiamaka', '8061928057'),
      ('David-Onuoha Mmesoma Milagro', '9060694909'),
      ('Orji Chiugo', '7032689219'),
      ('Aliozor Lilian Chinenyenwa', '8103210416'),
      ('Akandu Oluchukwu Ifunanya', '8112586355'),
      ('CHIMA GLORY CHISOM', '7047484153'),
      ('Austin-Nwaroh Ogechukwu Precious', '8087332771'),
      ('Ezechi Chinwe', null)
  ),
  -- Match each account to the official list: phone first (the only truly
  -- unique identifier here), then the same set of names, then the exact name.
  matched as (
    select p.id, p.full_name, o.full_name as listed_as
    from profiles p
    join official o
      on (public.im_phone_key(o.phone) is not null
          and public.im_phone_key(o.phone) in (public.im_phone_key(p.phone),
                                               public.im_phone_key(p.whatsapp_number)))
      or public.im_name_set(o.full_name) = public.im_name_set(p.full_name)
      or public.im_name_key(o.full_name) = public.im_name_key(p.full_name)
  )
update profiles p
set member_status = 'left'
where p.id not in (select id from matched)
  and p.member_status <> 'left'
  and not exists (
    select 1 from user_roles ur where ur.user_id = p.id and ur.role <> 'member'
  );

-- Also block sign-in, if migration 0015_member_access.sql has been run.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'profiles' and column_name = 'access_revoked_at') then
    execute $q$
      update profiles set access_revoked_at = now(),
                          access_revoked_reason = 'Not on the official media members list'
      where member_status = 'left' and access_revoked_at is null
    $q$;
  end if;
end $$;

-- What you are left with. Should be at most the size of your list.
select count(*) filter (where member_status <> 'left') as active_accounts,
       count(*)                                        as total_rows
from profiles;

commit;
