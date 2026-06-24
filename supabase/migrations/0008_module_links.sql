-- Allow multiple content links per module (e.g. several YouTube videos).
-- content_url stays as the first/primary link for backward compatibility;
-- content_urls holds the full list.
alter table modules add column if not exists content_urls jsonb not null default '[]';
