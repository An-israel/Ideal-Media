-- Welfare should also follow up on members the secretary marks inactive
-- (not just traveled). Add an 'inactive' reason for welfare follow-ups.
alter type welfare_reason add value if not exists 'inactive';
