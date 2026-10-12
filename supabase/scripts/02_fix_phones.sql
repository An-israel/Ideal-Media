-- ============================================================================
--  02_fix_phones.sql  —  THIS CHANGES DATA.
-- ============================================================================
--  Run 00_helpers.sql first.
--
--  Where the members list and a unit sheet disagree about somebody's phone
--  number, the unit sheet wins — it comes from the leader who actually works
--  with them, and one of those sheets already corrected a typo the members
--  list had carried for weeks.
--
--  Every change is written out by name with the OLD and NEW number visible, so
--  each one can be checked at a glance. Nothing here is matched by guesswork.
--
--  The phone number matters beyond being a contact detail: it is the key every
--  other script matches people on, so a wrong one quietly attaches a person to
--  the wrong record.
-- ============================================================================

-- ----------------------------------------------------------------------------
--  STEP 1 — look before you change anything. Each row should be ONE person.
-- ----------------------------------------------------------------------------
with fixes(official_name, old_number, new_number, why) as (
  values
    ('Ezedinachi Emmanuel Chidubem', '1806973270', '08106973270',
      'members list dropped a digit; 1806... is not a Nigerian mobile'),
    ('Agbo Amarachi Emmanuella',     '9022035639', '07049709807',
      'same person as "Agbo Amarachi Grace" on the Production sheet'),
    ('Owan Flourish Worma',          '9160781869', '09049146306',
      'changed number; Production sheet is current'),
    ('Orji Chiugo',                  '7032689219', '7032680219',
      'one digit differs; Photography sheet is current'),
    ('Sunday Chinemerem Emmanuel',   '8106313516', '9112424977',
      'Photography sheet is current'),
    ('Emeka Goodness Nzubechi',      '7065829586', '7048869525',
      'Photography sheet is current'),
    ('Victor Sam',                   null,         '9162645815',
      'members list had no number at all')
)
select f.official_name,
       count(p.id)                             as accounts_found,
       coalesce(string_agg(p.phone, ' | '), '(none)') as phone_now,
       f.new_number                            as will_become,
       f.why
from fixes f
left join profiles p on public.im_name_key(p.full_name) = public.im_name_key(f.official_name)
group by f.official_name, f.new_number, f.why
order by count(p.id), f.official_name;

-- STOP. In the result above, every row should show accounts_found = 1.
-- A 0 means that name is spelled differently on the site — send it to me.
-- A 2 or more means there are duplicate accounts; fix those first (script 01).

-- ----------------------------------------------------------------------------
--  STEP 2 — apply. Only run this once step 1 looks right.
-- ----------------------------------------------------------------------------
begin;

update profiles p
set phone = f.new_number,
    whatsapp_number = case
      -- Only move the WhatsApp number when it was the wrong one too, so a
      -- separately-correct WhatsApp number is not overwritten.
      when p.whatsapp_number is null
        or public.im_phone_key(p.whatsapp_number) is not distinct from public.im_phone_key(p.phone)
      then f.new_number
      else p.whatsapp_number
    end
from (values
    ('Ezedinachi Emmanuel Chidubem', '08106973270'),
    ('Agbo Amarachi Emmanuella',     '07049709807'),
    ('Owan Flourish Worma',          '09049146306'),
    ('Orji Chiugo',                  '07032680219'),
    ('Sunday Chinemerem Emmanuel',   '09112424977'),
    ('Emeka Goodness Nzubechi',      '07048869525'),
    ('Victor Sam',                   '09162645815')
  ) as f(official_name, new_number)
where public.im_name_key(p.full_name) = public.im_name_key(f.official_name);

-- Confirm.
select full_name, phone, whatsapp_number
from profiles
where public.im_name_key(full_name) in (
  public.im_name_key('Ezedinachi Emmanuel Chidubem'),
  public.im_name_key('Agbo Amarachi Emmanuella'),
  public.im_name_key('Owan Flourish Worma'),
  public.im_name_key('Orji Chiugo'),
  public.im_name_key('Sunday Chinemerem Emmanuel'),
  public.im_name_key('Emeka Goodness Nzubechi'),
  public.im_name_key('Victor Sam')
)
order by full_name;

commit;
