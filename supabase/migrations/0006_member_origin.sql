-- How each member entered the system, so you can tell self-signups apart from
-- people added via the secretary import or by welfare. Preserved even after an
-- imported/welfare member later claims their account by signing up.
alter table profiles add column if not exists member_origin text not null default 'self_signup';
-- Backfill: anyone not yet claimed was added by import/welfare (treat as import).
update profiles set member_origin = 'import' where claimed = false and member_origin = 'self_signup';
