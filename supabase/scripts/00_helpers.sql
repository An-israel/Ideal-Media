-- ============================================================================
--  00_helpers.sql  —  run this FIRST, once.
-- ============================================================================
--  Matching functions used by every script that follows. Safe to re-run.
--
--  A name is compared as a SORTED SET of its words, so "Opara Chidumebi
--  Elisheva" and "Elisheva Opara Chidumebi" are the same person, and
--  apostrophes and hyphens stop mattering ("God'swill", "Austin-Nwaroh").
--
--  A phone is compared on its last 9 digits, so 08031234567, 8031234567 and
--  +2348031234567 all agree.
-- ============================================================================

create or replace function public.im_name_key(n text) returns text
language sql immutable as $$
  select trim(regexp_replace(
           regexp_replace(lower(coalesce(n, '')), '[^a-z0-9]+', ' ', 'g'),
           '\s+', ' ', 'g'))
$$;

create or replace function public.im_name_set(n text) returns text
language sql immutable as $$
  select coalesce(array_to_string(array(
    select tok from unnest(string_to_array(public.im_name_key(n), ' ')) as tok
    where tok <> '' order by tok
  ), ' '), '')
$$;

create or replace function public.im_phone_key(p text) returns text
language sql immutable as $$
  select case
           when length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) >= 9
           then right(regexp_replace(p, '\D', '', 'g'), 9)
           else null
         end
$$;

-- The words of a name as a sorted array, for "is one name contained in the
-- other" comparisons — "Majesty Gift" inside "Majesty Gift Chijindu".
create or replace function public.im_name_arr(n text) returns text[]
language sql immutable as $$
  select array(
    select tok from unnest(string_to_array(public.im_name_key(n), ' ')) as tok
    where tok <> '' order by tok
  )
$$;
