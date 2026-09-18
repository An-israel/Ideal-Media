# Ideal Media

A management platform for a church media department — LMS, attendance tracking,
welfare follow-up, secretary roster management, a mandatory code-of-conduct
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
3. `npm install && npm run dev` → open http://localhost:3000 (redirects to `/login`).
4. **Sign up** to create a member; you'll be routed through the COC gate before
   the dashboard. Promote yourself to `super_admin` by inserting a row into
   `user_roles` for your user id while building out later phases.

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
    auth/callback/  exchanges Supabase email links for a session (password reset)
    api/cron/       Vercel Cron routes (excluded from the proxy; self-authenticating)
  lib/
    supabase/       browser / server / admin clients + proxy session refresh
    auth.ts         getSessionRoles() helper
    queries.ts      batched server-side performance computation
    pagination.ts   fetchAllRows() — pages past PostgREST's silent 1000-row cap
    sheets.ts       pure spreadsheet reading / merging (unit tested)
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

Tests cover the pure logic that ingestion depends on: spreadsheet reading
(including multi-sheet workbooks), attendance de-duplication, AI proposal
merging, calendar-date coercion, and phone normalisation.
