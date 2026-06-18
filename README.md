# Ideal Media

A management platform for a church media department — LMS, attendance tracking,
welfare follow-up, secretary roster management, a mandatory code-of-conduct
gate, and multi-tier admin. Built with Next.js (App Router), Supabase
(Postgres + RLS + Auth + Storage), Tailwind + shadcn-style UI, and the
Anthropic Claude API for attendance parsing.

## Build status (by phase, per the spec §17)

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
| 8 | Notifications, performance, polish | 🟡 Partial (bell + notifications, composite performance, role-aware nav) |

## Getting started

1. **Create a Supabase project** and copy `.env.example` to `.env.local`, filling in:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server only)
   - `ANTHROPIC_API_KEY` (server only, used in Phase 5)
   - `NEXT_PUBLIC_APP_URL`
2. **Run the migrations** in `supabase/migrations/` in order (via the Supabase
   SQL editor or `supabase db push`):
   - `0001_schema.sql` — tables, enums, indexes, constraints
   - `0002_rls.sql` — RLS enabled on every table + explicit policies + helpers
   - `0003_seed.sql` — subunits, activities, default COC + question bank, settings
3. `npm install && npm run dev` → open http://localhost:3000 (redirects to `/login`).
4. **Sign up** to create a member; you'll be routed through the COC gate before
   the dashboard. Promote yourself to `super_admin` by inserting a row into
   `user_roles` for your user id while building out later phases.

## Security model (non-negotiables, spec §0/§16)

- **RLS is the security model.** Every table has RLS enabled with explicit
  policies; helper functions (`is_super_admin`, `leads_subunit`, `leads_member`,
  …) are `SECURITY DEFINER` to avoid recursive policy evaluation.
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
  lib/
    supabase/       browser / server / admin clients + proxy session refresh
    auth.ts         getSessionRoles() helper
    queries.ts      reusable server-side performance computation
    constants.ts    tunable weights, thresholds, model id
supabase/migrations/  schema, RLS, seed
```
