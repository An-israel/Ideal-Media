-- Adds a "claimed" flag so bulk-imported members can be claimed at signup by
-- phone/email (they set their own password then) instead of via reset emails.
-- Normal signups are claimed immediately; imported rows are created unclaimed.
alter table profiles add column if not exists claimed boolean not null default true;
