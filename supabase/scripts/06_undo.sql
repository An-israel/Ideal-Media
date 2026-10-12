-- ============================================================================
--  06_undo.sql  —  put somebody back.
-- ============================================================================
--  Nothing the other scripts do is destructive: removal only marks a person
--  'left' (and blocks sign-in if 0015 has been run). No row is deleted, so
--  attendance history survives and anyone can be restored.
-- ============================================================================

-- ONE person back (edit the name). Check first:
select id, full_name, phone, member_status
from profiles
where public.im_name_key(full_name) like '%' || public.im_name_key('PUT THE NAME HERE') || '%';

-- Then restore them:
update profiles
set member_status = 'active'
where public.im_name_key(full_name) = public.im_name_key('PUT THE NAME HERE');

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'profiles' and column_name = 'access_revoked_at') then
    execute $q$
      update profiles
      set access_revoked_at = null, access_revoked_by = null, access_revoked_reason = null
      where public.im_name_key(full_name) = public.im_name_key('PUT THE NAME HERE')
    $q$;
  end if;
end $$;

-- ----------------------------------------------------------------------------
--  EVERYONE back — undoes 02 completely. Use if the removal went wrong.
-- ----------------------------------------------------------------------------
-- update profiles set member_status = 'active' where member_status = 'left';
-- do $$
-- begin
--   if exists (select 1 from information_schema.columns
--              where table_name = 'profiles' and column_name = 'access_revoked_at') then
--     execute 'update profiles set access_revoked_at = null,
--                                  access_revoked_by = null,
--                                  access_revoked_reason = null';
--   end if;
-- end $$;
