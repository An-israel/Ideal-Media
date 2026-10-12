-- ============================================================================
--  0016_rename_technical_unit.sql
-- ============================================================================
--  The department calls this unit "Technical". It was seeded as "Utility
--  (Videography & Technical)", which is the name on every page that lists
--  subunits, in the attendance report's breakdown, and in the subunit picker.
--
--  The slug is refreshed with the name, which is what Admin -> Subunits does
--  when you rename one (the member import matches on BOTH name and slug, so a
--  slug left behind on the old name goes on silently matching it).
--
--  Safe to run more than once, and safe to run before or after the subunit
--  assignment scripts: those accept either name.
-- ============================================================================

update subunits
set name = 'Technical',
    slug = 'technical'
where slug = 'utility'
   or name = 'Utility (Videography & Technical)';

select name, slug, category from subunits order by category, name;
