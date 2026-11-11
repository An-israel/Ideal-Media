-- ============================================================================
--  0019_claim_invites.sql — a link that lets one person claim one record
-- ============================================================================
--  A member who was added to the roster by somebody else claims that record
--  when they sign up, and the match is made on their email, or on their phone
--  number plus their name. That leaves out exactly the people the subunit
--  sheets named with nothing but a first name — "Onyinye", "Ugochi" — who have
--  neither on record. When they sign up there is nothing to match, so they get
--  a brand-new second account and the one the department made for them sits
--  unclaimed for ever, holding their unit and their attendance.
--
--  An invite is the secretary saying "this record is yours": a single-use link
--  that claims one specific record, whatever is or is not on it.
--
--  The token itself is never stored — only its SHA-256 — so reading this table
--  does not let anyone claim an account. And the table has row level security
--  switched on with NO policies, which means only the server (service role)
--  can read or write it: a leader can see their members' profile rows, and an
--  invite kept on the profile would have been theirs to read and use.
-- ============================================================================

create table if not exists member_claim_invites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  token_hash text not null unique,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists member_claim_invites_user on member_claim_invites (user_id);

alter table member_claim_invites enable row level security;
-- Deliberately no policies: service role only.

comment on table member_claim_invites is
  'Single-use links that let a person claim one specific roster record at signup. Stores only a hash of the token. Service role only.';

select 'Claim invites ready. Create one from Secretary -> Roster.' as result;
