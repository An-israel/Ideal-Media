-- ============================================================================
--  0018_harden_member_writes.sql — what a member may write about themselves
-- ============================================================================
--  The app's pages only ever let a member change their own name, phone numbers,
--  location and birthday. The DATABASE let them change far more, because the
--  browser holds the public API key and the member's own token, and those two
--  are all it takes to call the database directly, with no page involved.
--
--  Each of these was confirmed by doing it against a copy of the schema, as an
--  ordinary member, before this file was written:
--
--    1. profiles_update_self had no column limits, so a member could set
--       coc_completed = true and skip the Code of Conduct, or — worse — clear
--       access_revoked_at on their own row and undo their own removal.
--    2. teaching_progress accepted any row a member wrote for themselves, so
--       "played it through, 3600 seconds listened" could simply be inserted.
--       The General Training report exists to say who has genuinely listened;
--       it could be forged in one request.
--    3. module_progress accepted an insert that was already status 'approved',
--       with a leader's id in approved_by — a course module passed without the
--       leader ever seeing it.
--    4. coc_attempts accepted a forged passed attempt.
--    5. subunit_members let a member make themselves a PRIMARY member of any
--       unit, which puts them on that unit's attendance roll and skips the
--       approval a change of primary unit is supposed to need.
--
--  The server code already does the right thing in every one of these places;
--  the fix is to stop the database accepting the write when it arrives any
--  other way. Server code uses the service role, which these rules do not
--  apply to. Safe to run more than once.
-- ============================================================================

-- ----------------------------------------------------------------------------
--  1. profiles: a member edits their contact details and nothing else
-- ----------------------------------------------------------------------------
create or replace function public.guard_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- No end-user identity: this is the server (service role) or the SQL editor.
  -- Both are trusted, and both are how every legitimate change to the columns
  -- below is made.
  if auth.uid() is null then
    return new;
  end if;

  if public.is_super_admin() then
    return new;
  end if;

  -- Nobody but a super admin (or the server) removes or restores access, or
  -- decides that somebody has accepted the Code of Conduct.
  if new.access_revoked_at     is distinct from old.access_revoked_at
     or new.access_revoked_by  is distinct from old.access_revoked_by
     or new.access_revoked_reason is distinct from old.access_revoked_reason
     or new.coc_completed      is distinct from old.coc_completed
     or new.coc_completed_at   is distinct from old.coc_completed_at
     or new.coc_version_accepted is distinct from old.coc_version_accepted
     or new.claimed            is distinct from old.claimed
     or new.member_origin      is distinct from old.member_origin
     or new.id                 is distinct from old.id
     or new.created_at         is distinct from old.created_at
  then
    raise exception 'That part of a profile can only be changed by an administrator.'
      using errcode = '42501';
  end if;

  -- The secretary keeps the roster, so they may set a status and correct an
  -- email. A member may do neither to their own row.
  if not public.has_role('secretary') then
    if new.member_status is distinct from old.member_status
       or new.email      is distinct from old.email
    then
      raise exception 'Your status and email can only be changed by the secretary or an administrator.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

comment on function public.guard_profile_columns() is
  'Stops a member changing protected columns on their own profile row (Code of Conduct, access removal, status, email) by calling the API directly. Server code and super admins are unaffected.';

drop trigger if exists guard_profile_columns on profiles;
create trigger guard_profile_columns
  before update on profiles
  for each row execute function public.guard_profile_columns();

-- Every profile is created by the server (signup, import, the roster). Nothing
-- in the app inserts one with the member's own token, and allowing it let a
-- row arrive with coc_completed already true.
drop policy if exists profiles_insert on profiles;

-- ----------------------------------------------------------------------------
--  2. teaching_progress: written by the server, which measures real playback
-- ----------------------------------------------------------------------------
-- reportProgress() clamps each tick to the reporting interval so that seeking
-- to the end does not count as listening. That clamp is worthless while the
-- row can be written directly, so members may now only READ their progress.
drop policy if exists teaching_progress_insert on teaching_progress;
drop policy if exists teaching_progress_update on teaching_progress;

-- ----------------------------------------------------------------------------
--  3. module_progress: a member can submit work, never approve it
-- ----------------------------------------------------------------------------
drop policy if exists module_progress_insert_self on module_progress;
create policy module_progress_insert_self on module_progress for insert with check (
  user_id = auth.uid()
  and status <> 'approved'
  and approved_by is null
  and approved_at is null
);

-- ----------------------------------------------------------------------------
--  4. coc_attempts: recorded by the server when it grades the quiz
-- ----------------------------------------------------------------------------
drop policy if exists coc_attempts_insert on coc_attempts;

-- ----------------------------------------------------------------------------
--  5. subunit_members: joining is free, choosing your primary unit is not
-- ----------------------------------------------------------------------------
-- A member's FIRST subunit becomes their primary — that is how somebody new
-- gets onto a roll at all, and it stays. After that, a join is an extra unit;
-- moving the primary goes through a request that a leader approves.
drop policy if exists subunit_members_insert_self on subunit_members;
create policy subunit_members_insert_self on subunit_members for insert with check (
  public.is_super_admin()
  or (
    user_id = auth.uid()
    and role_in_subunit = 'member'
    and public.access_active()
    and (
      membership_type = 'secondary'
      or not exists (
        select 1 from subunit_members mine where mine.user_id = auth.uid()
      )
    )
  )
);

select 'Member writes hardened. Nothing changes for anyone using the site normally.' as result;
