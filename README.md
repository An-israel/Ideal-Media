# Ideal Media

A management platform for a church media department — department-wide training
with listen tracking, an LMS, attendance tracking, welfare follow-up, secretary
roster management, member-driven subunit changes, a mandatory code-of-conduct
gate, and multi-tier admin. Built with Next.js (App Router), Supabase
(Postgres + RLS + Auth + Storage), Tailwind + shadcn-style UI, and the
Anthropic Claude API for attendance parsing.

## Build status

An audit of the whole product is in [`AUDIT.md`](./AUDIT.md) — 69 findings, all
fixed in migration `0011_audit_fixes.sql` and the accompanying code changes.
Notably, several things the phase table below previously marked "done" did not
actually work: the birthday cron was unreachable, password reset had no auth
callback route, multi-sheet imports read one sheet, welfare levels never
escalated, and the code-of-conduct gate could be passed with a single correct
answer. Those are now genuinely done.

**Run `npm run check` (typecheck + lint + tests) before pushing.** CI runs the
same thing plus a build.

## Phases (per the spec §17)

| Phase | Scope | Status |
|---|---|---|
| 0 | Scaffold — Next.js + TS + Tailwind + design tokens + light/dark + Supabase clients + route groups | ✅ Done |
| 1 | Auth & identity — login, signup w/ subunit selection, profiles/roles/memberships, seed data, middleware gating | ✅ Done |
| 2 | Code-of-conduct gate — read → quiz (reshuffled) → pass, server-side grading, `coc_completed` gating | ✅ Done |
| — | **Full DB schema + RLS for every table** (the security model is in place up front) | ✅ Done |
| 3 | Courses — builder, player, sequential gating, WhatsApp submission, secondary-course apply + leader approvals | ✅ Done |
| 4 | Leader dashboard — members list, member detail (course/attendance breakdown + performance), approvals queue | ✅ Done |
| 5 | Attendance + AI ingestion — upload → SheetJS → Claude (forced tool-use) → review → commit + welfare auto-flag | ✅ Done |
| 6 | Welfare board (filters, level/status/notes/assignment, WhatsApp) + secretary roster (bulk status, recently-missed view) | ✅ Done |
| 7 | Super admin — analytics, members, roles, subunits, activities + threshold, COC + question bank | ✅ Done |
| 8 | Notifications (bell + triggers + mark-read), composite performance, loading/empty states, RLS audit | ✅ Done (Supabase Realtime left as the documented nice-to-have) |
| — | **Audit remediation** — RLS privilege escalation, COC gate integrity, password reset, cron reachability, multi-sheet imports, welfare escalation, the 1000-row PostgREST cap, tests + CI | ✅ Done (see `AUDIT.md`) |
| 9 | **General Training** — department-wide teaching series with real listen tracking, plus an admin report of who has and hasn't listened | ✅ Done |
| 10 | **Member-driven subunits** — browse every subunit, join extra ones, request their courses, and request a change of primary subunit | ✅ Done |

## Getting started

1. **Create a Supabase project** and copy `.env.example` to `.env.local`, filling in:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server only)
   - `ANTHROPIC_API_KEY` (server only, used in Phase 5)
   - `NEXT_PUBLIC_APP_URL`
   - `CRON_SECRET` (**required** — the birthday cron route refuses to run
     without it rather than failing open)
2. **Run the migrations** in `supabase/migrations/` in order (via the Supabase
   SQL editor or `supabase db push`):
   - `0001_schema.sql` — tables, enums, indexes, constraints
   - `0002_rls.sql` — RLS enabled on every table + explicit policies + helpers
   - `0003_seed.sql` — subunits, activities, default COC + question bank, settings
   - `0004`–`0010` — storage bucket, claim flag, member origin, birthdays,
     module links, monthly summaries, welfare `inactive` reason
   - `0011_audit_fixes.sql` — **required.** Closes the RLS privilege-escalation
     holes, makes members deletable, adds COC quiz integrity + versioned
     re-acceptance, the atomic `publish_coc_version` and `move_module`
     functions, missing uniqueness, and the indexes the real queries need.
   - `0012_training_and_subunit_requests.sql` — **required.** General Training
     (series, teachings, per-member listen progress, the private `training`
     storage bucket) and subunit change requests.

   Both 0011 and 0012 are idempotent — re-running them is safe.

3. **Raise the Storage upload limit** if you will host long teachings.
   Migration 0012 sets the `training` bucket's own limit to 200MB, but the
   PROJECT limit wins if it is lower: Supabase Dashboard → Storage → Settings.
4. `npm install && npm run dev` → open http://localhost:3000 (redirects to `/login`).
5. **Sign up** to create a member; you'll be routed through the COC gate before
   the dashboard. Promote yourself to `super_admin` by inserting a row into
   `user_roles` for your user id while building out later phases.

## General Training

A department-wide teaching series every member reaches from their own dashboard
and from **General Training** in the sidebar. Separate from courses: no
assignments, no leader approval — just teaching to listen to, with tracking.

**"Has listened" means it.** The player accumulates real playback time and
ignores any jump bigger than a couple of seconds, because such a jump is a seek
rather than listening. Dragging the slider to the end leaves the counted total at
almost nothing. A teaching auto-completes at 90% actually played
(`TEACHING_COMPLETE_FRACTION`), and each progress report is clamped server-side
so a client cannot claim an hour of listening in one request.

A member who listened elsewhere can tick **I've already listened to this**. That
is recorded as `completion_source = 'manual'` and counted separately in the
report, so a self-declaration is never mistaken for a measured playthrough.

- **Members:** `/training` — the library, with their own progress.
- **Super admin + secretary:** `/training/manage` — add series and teachings,
  publish them, see the whole department's progress, and nudge whoever is
  outstanding on a given teaching.
- **Subunit leaders:** the same page, scoped to their own subunits' members.

Media uploads go **browser → Supabase Storage directly** via a signed upload
URL, because a server action caps its request body at 1MB and buffering a
200MB file in the Next process would be pointless. The server authorises the
upload and records the row; the bucket stays private and playback uses
short-lived signed URLs.

## Subunits: joining and moving

Members manage their own memberships at `/subunits`:

- **Joining an extra subunit is instant** — it costs nothing to undo, and it is
  what unlocks that subunit's courses to request.
- **Changing PRIMARY subunit needs approval.** Primary decides which attendance
  register a member appears on and which courses auto-enroll them, so a leader
  of either side (or a secretary/super admin) signs it off at
  `/subunits/requests`. This is the fix for someone who joined the wrong unit:
  they ask, with a reason, and it is applied properly rather than silently.

On approval the old primary becomes an additional membership rather than being
deleted, so the member's history in that subunit is kept.

## Security model (non-negotiables, spec §0/§16)

- **RLS is the security model.** Every table has RLS enabled with explicit
  policies; helper functions (`is_super_admin`, `leads_subunit`, `leads_member`,
  …) are `SECURITY DEFINER` to avoid recursive policy evaluation.
- **Self-inserts cannot grant privilege.** A member may insert themselves into a
  subunit only as `role_in_subunit = 'member'`, may write their own
  `module_progress` only to a non-approved status, and may insert their own
  `enrollments` only as `pending_application`. Without these three constraints
  a member could make themselves a leader, approve their own assignments, and
  self-enroll in any course (migration 0011).
- **The COC gate is graded server-side against a server-issued quiz.** The set
  of questions and the denominator both live in `coc_quiz_issues`; a submission
  consumes one issue, so answers cannot be cherry-picked and attempts are rate
  limited.
- **`WITH CHECK`, not just `USING`.** A member may touch their own
  `subunit_requests` row (to cancel it) and their own `teaching_progress` row,
  but `WITH CHECK` constrains what they may write — a member cannot approve
  their own subunit move or fabricate someone else's listen record. `USING`
  decides which rows you may touch; `WITH CHECK` decides what you may put in
  them.
- **Secrets stay server-side.** The service-role and Anthropic keys are only
  used in server actions / route handlers via the admin client and are never
  imported into client components.
- **Defense in depth.** Roles are checked both in RLS and in `proxy.ts`
  (route-group gating) + server actions.
- **No landing page.** Unauthenticated users go straight to `/login`.

## Project layout

```
src/
  app/
    (auth)/         login, signup (multi-step subunit picker), reset-password
    coc/            code-of-conduct gate (server-graded quiz)
    (app)/          authenticated shell: dashboard, courses, leader, secretary,
                    welfare, admin, notifications
  components/       ui/ (shadcn-style primitives), app/ (shell, nav, ring)
  app/
    (app)/training/ General Training: library, player, manage + listen report
    (app)/subunits/ subunit directory, join/leave, primary-change requests
    auth/callback/  exchanges Supabase email links for a session (password reset)
    api/cron/       Vercel Cron routes (excluded from the proxy; self-authenticating)
  lib/
    supabase/       browser / server / admin clients + proxy session refresh
    auth.ts         getSessionRoles() helper
    queries.ts      batched server-side performance computation
    pagination.ts   fetchAllRows() — pages past PostgREST's silent 1000-row cap
    sheets.ts       pure spreadsheet reading / merging (unit tested)
    training.ts     training library queries + the listen report
    training-progress.ts  listen maths: percent, completion, clamping (unit tested)
    format.ts       duration / clock formatting (unit tested)
    dates.ts        calendar-day helpers (no UTC round-trips)
    phone.ts        phone normalisation + wa.me links
    member-admin.ts orphan-safe member creation
    constants.ts    tunable weights, thresholds, model ids
supabase/migrations/  schema, RLS, seed, audit fixes
```

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test` | Vitest unit tests |
| `npm run check` | typecheck + lint + test — run this before pushing |

Tests cover the pure logic the app's correctness depends on: spreadsheet reading
(including multi-sheet workbooks), attendance de-duplication, AI proposal
merging, calendar-date coercion, phone normalisation, and the listen-tracking
maths that decides whether "has listened" is true.
