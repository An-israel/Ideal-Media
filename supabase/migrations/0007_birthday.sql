-- Member birthdays (month/day only — year isn't collected). Used for welfare's
-- upcoming-birthday panel and the on-the-day reminder.
alter table profiles add column if not exists birth_month smallint;
alter table profiles add column if not exists birth_day smallint;
