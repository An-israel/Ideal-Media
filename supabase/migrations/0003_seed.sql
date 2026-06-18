-- Ideal Media — seed data (Section 4). Idempotent where practical.

-- Subunits ------------------------------------------------------------------
insert into subunits (name, slug, category) values
  ('Photography', 'photography', 'primary'),
  ('Projection', 'projection', 'primary'),
  ('Production', 'production', 'primary'),
  ('Social Media', 'social-media', 'primary'),
  ('Utility (Videography & Technical)', 'utility', 'primary'),
  ('Graphic Design', 'graphic-design', 'secondary'),
  ('Video Editing', 'video-editing', 'secondary'),
  ('Welfare', 'welfare', 'secondary'),
  ('Secretary', 'secretary', 'secondary'),
  ('Publication', 'publication', 'secondary')
on conflict (slug) do nothing;

-- Activities ----------------------------------------------------------------
insert into activities (name, day_of_week, time_of_day, is_attendance_signal) values
  ('Sunday Service', 'Sunday', 'Morning', true),
  ('Bible Study', 'Wednesday', 'Evening', false),
  ('Morning Prayer', 'Saturday', 'Morning', false),
  ('Set Up', 'Saturday', 'Evening', false)
on conflict do nothing;

-- App settings --------------------------------------------------------------
insert into app_settings (key, value) values
  ('missed_service_threshold', '2'::jsonb)
on conflict (key) do nothing;

-- Code of conduct -----------------------------------------------------------
insert into code_of_conduct (version, title, body, is_active) values
  (1, 'Media Department Code of Conduct',
$$# Media Department Code of Conduct

Welcome to the media team. As a member you represent the department in
everything you do. Please read this carefully before continuing.

## 1. Commitment
Members are expected to attend Sunday Service and the activities relevant to
their subunit. Consistent absence without notice will be followed up by the
welfare team.

## 2. Conduct
Treat fellow members, leaders, and the congregation with respect. Handle all
equipment with care and report any damage immediately.

## 3. Confidentiality
Footage, photographs, and recordings belong to the church. Do not share or
publish any material without approval from your subunit leader.

## 4. Growth
Complete the courses assigned to your subunit. Each module must be approved by
your leader before you move on. Submit your assignments promptly.

## 5. Communication
Assignment submissions are coordinated with your leader over WhatsApp. Keep
your contact details up to date.

By agreeing below you confirm that you have read and understood this code of
conduct and agree to abide by it.$$,
  true)
on conflict do nothing;

-- COC question bank ---------------------------------------------------------
insert into coc_questions (question, options, correct_option_index, is_active) values
  ('Which service is the primary attendance signal for the media team?',
   '["Bible Study","Sunday Service","Morning Prayer","Set Up"]'::jsonb, 1, true),
  ('Before you can start the next module in a course, what must happen?',
   '["Nothing, all modules are open","Your leader must approve the previous module''s assignment","You must pay a fee","An admin must email you"]'::jsonb, 1, true),
  ('Who do footage and photographs you capture belong to?',
   '["You personally","Your subunit leader","The church","Whoever is in the photo"]'::jsonb, 2, true),
  ('How are assignment submissions coordinated with your leader?',
   '["By post","Over WhatsApp","In person only","They are not coordinated"]'::jsonb, 1, true),
  ('What should you do if you damage a piece of equipment?',
   '["Hide it","Report it immediately","Replace it secretly","Ignore it"]'::jsonb, 1, true),
  ('Can you publish church media material without approval?',
   '["Yes, anytime","Only on weekends","No, you need approval from your subunit leader","Yes, if it looks good"]'::jsonb, 2, true),
  ('What happens if you are absent from service repeatedly without notice?',
   '["Nothing","The welfare team will follow up with you","You are removed instantly","You get a fine"]'::jsonb, 1, true),
  ('How many primary subunits must every member belong to?',
   '["Zero","Exactly one","At least three","As many as they like"]'::jsonb, 1, true)
on conflict do nothing;
