# Ideal Media — Critical Audit

**Date:** 2026-09-16
**Branch:** `claude/optimistic-lamport-beijdf`
**Method:** Full static audit — every feature traced end to end through app code, server actions, DB schema and RLS policies. `tsc --noEmit`, `eslint` and `next build` all run clean (exit 0); all 26 routes compile.
**Scope:** Nothing in this report has been fixed. It is a diagnosis only.

---

## How to use this document

Each finding has an ID (`SEC-1`, `ATT-3`, …). Reply with the IDs you want actioned and how:

- **Fix** — it's broken, repair it
- **Improve** — it works but should be better
- **Leave** — acceptable as-is

Severity:

| | Meaning |
|---|---|
| 🔴 | Broken or exploitable. Feature does not work, or security is compromised. |
| 🟠 | Real bug. Works in the happy path, fails in a realistic case. |
| 🟡 | Weakness / gap. Works, but fragile, incomplete, or will break as you grow. |

---

## Summary scoreboard

| Area | Working | 🔴 | 🟠 | 🟡 |
|---|---|---|---|---|
| Security & access control | Partly | 6 | 2 | 2 |
| Auth / identity / COC | Partly | 2 | 2 | 3 |
| Courses / LMS | Mostly | 0 | 3 | 4 |
| Attendance + AI ingestion | Mostly | 1 | 6 | 5 |
| Welfare | Mostly | 1 | 4 | 3 |
| Secretary roster + imports | Mostly | 1 | 4 | 3 |
| Super admin | Mostly | 0 | 4 | 3 |
| Notifications | Partly | 1 | 2 | 1 |
| Scale / performance | — | 0 | 3 | 3 |
| **Totals** | | **12** | **30** | **27** |

**69 findings.** The 12 red items are the ones I'd argue must be fixed before this is used with real member data.

---

# A. Security & access control

### 🔴 SEC-1 — Any member can promote themselves to subunit leader
`supabase/migrations/0002_rls.sql` — policy `subunit_members_insert_self`

```sql
create policy subunit_members_insert_self on subunit_members for insert with check (
  user_id = auth.uid() or public.is_super_admin()
);
```

The policy checks *who* the row is for, but never `role_in_subunit` or `membership_type`. Any signed-in member can insert, straight from the browser with the anon key:

```js
supabase.from("subunit_members").insert({
  user_id: myId, subunit_id: anySubunit, membership_type: "secondary", role_in_subunit: "leader"
})
```

`leads_subunit()` then returns true for them, which unlocks, via RLS: creating and editing courses, reading every member's profile in that subunit (`leads_member`), reading their attendance records, and approving course applications. **This is the single widest hole in the app** — it turns a member into a leader in one request and every other leader-scoped policy trusts it.

### 🔴 SEC-2 — Members can approve their own assignments
`supabase/migrations/0002_rls.sql` — `module_progress_update`; `src/app/(app)/leader/actions.ts:9`

```sql
create policy module_progress_update on module_progress for update using (
  user_id = auth.uid() or public.is_super_admin() or public.leads_subunit(...)
);
```

`user_id = auth.uid()` is needed so a member can mark a module in progress — but it also lets them set `status = 'approved'`. Two ways to exploit:

1. Direct: `supabase.from("module_progress").update({status:"approved"}).eq("id", myProgressId)`
2. Via the server action: `approveModule(myOwnProgressId)` — `src/app/(app)/leader/actions.ts:9` authenticates the caller but **never checks they are a leader of the course's subunit**.

This defeats leader approval and, because unlocking is driven off `approved`, the whole sequential course gate.

### 🔴 SEC-3 — Members can self-enroll in any course
`supabase/migrations/0002_rls.sql` — `enrollments_insert_self`

```sql
create policy enrollments_insert_self on enrollments for insert with check (
  user_id = auth.uid() or public.is_super_admin()
);
```

No restriction on `status` or on which course. A member can insert `{user_id: me, course_id: anyCourse, status: "enrolled"}` and skip the secondary-course application + leader-approval flow entirely (`src/app/(app)/courses/actions.ts:10` is the intended path).

### 🔴 SEC-4 — COC quiz gate is trivially bypassable
`src/app/coc/actions.ts:41` (`gradeQuiz`)

The server grades whatever array the client sends and derives the total from it:

```ts
const total = answers.length;
...
const passed = total > 0 && score / total >= COC_PASS_THRESHOLD; // threshold = 1.0
```

There is no server-side record of which questions were issued and no check that `answers.length === COC_QUIZ_SIZE`. So `gradeQuiz([{questionId: <any id>, selectedIndex: <correct>}])` gives `total=1, score=1` → **pass**, and `profiles.coc_completed` is set. `getQuizQuestions()` is itself a callable server action that hands out question ids and options, so the attacker doesn't even need to guess. There is also no attempt limit or cooldown on `coc_attempts`, so brute force works even without this shortcut.

The mandatory code-of-conduct gate is the app's one compliance control. Right now it is decorative.

### 🔴 SEC-5 — Unclaimed member accounts can be taken over with no verification
`src/app/(auth)/signup/actions.ts:47` (`signUpAction`)

Every imported / secretary-added / welfare-added member exists as an **unclaimed** profile with a real name, phone and sometimes email. The signup flow matches on email, or on the last 10 digits of a phone number, and if the match is unclaimed it:

- sets the attacker's chosen password on that account (`updateUserById`)
- moves the login email to the attacker's email
- marks the profile claimed

No SMS OTP, no email confirmation, no admin approval. `admin.auth.admin.createUser({..., email_confirm: true})` means self-signups are never email-verified either. Anyone who knows a member's phone number — semi-public information in a church — can take over that member's account, including one that was imported with a leadership role or a privileged role grant.

This is the documented design (claim-by-phone, README), so it may be an accepted tradeoff — but it should be an explicit decision, not an accident.

### 🔴 SEC-6 — Birthday cron endpoint is open by default
`src/app/api/cron/birthdays/route.ts:13`; `.env.example`

```ts
const secret = process.env.CRON_SECRET;
if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) { ... 401 }
```

`CRON_SECRET` is documented as *optional*. If unset the route has no auth at all, and anyone can (a) spam every welfare member with notifications and (b) flip the `birthday_notified_on` marker so the real run is skipped. Should fail closed, not open. (See also NOTIF-1 — the route can't actually be reached by Vercel right now, which masks this.)

### 🟠 SEC-7 — Secretary can delete any account, including super admins
`src/app/(app)/secretary/roster/actions.ts:168` (`removeMembers`)

The only guard is "not yourself". A secretary can permanently delete the super admin, the other secretaries, or every leader. Destructive and irreversible (cascades attendance, progress, memberships). Needs a role guard — at minimum, refuse to delete anyone holding `super_admin`, and probably restrict hard deletion to super admin, with secretaries limited to setting `member_status = 'left'`.

### 🟠 SEC-8 — Super admin can revoke their own super_admin role
`src/app/(app)/admin/actions.ts:27` (`revokeRole`)

No guard against removing the last `super_admin`. One click locks the entire organisation out of `/admin` permanently — recoverable only by direct SQL in the Supabase console.

### 🟡 SEC-9 — Write-path server actions rely entirely on RLS, with no app-level role check
`src/app/(app)/leader/courses/actions.ts` — `updateCourse:40`, `setPublished:54`, `addModule:73`, `updateModule:116`, `deleteModule:155`, `moveModule:163`; `src/app/(app)/leader/actions.ts` — `rejectModule:43`, `decideApplication:70`

`createCourse` correctly calls `requireLeaderOfSubunit`, but the other seven do not authenticate or authorize at all — they just fire an RLS-scoped query. RLS does currently cover them, so this is not directly exploitable, but it contradicts the README's stated "defense in depth" model and means any future RLS slip becomes instantly exploitable. Given SEC-1 already grants leader status to anyone, these become writable by any member today.

### 🟡 SEC-10 — `notifications_insert` policy is effectively dead
`supabase/migrations/0002_rls.sql`

```sql
create policy notifications_insert on notifications for insert with check (public.is_super_admin());
```

All real inserts come through `src/lib/notify.ts` on the service-role client, which bypasses RLS. The policy is harmless but misleading — it reads as if super admins insert notifications, which is not how the app works.

---

# B. Auth, identity & the COC gate

### 🔴 AUTH-1 — Password reset is completely broken
`src/app/(auth)/reset-password/page.tsx:35`; no `src/app/auth/**` route exists

`resetPasswordForEmail` is called with `redirectTo: .../reset-password?mode=update`. With `@supabase/ssr` the email link comes back carrying a `code` that **must** be exchanged for a session via `exchangeCodeForSession` in a route handler. Verified:

- there is no `src/app/auth/` directory
- `find src/app -name route.ts` returns only the birthday cron
- `grep -rn "exchangeCodeForSession\|verifyOtp"` → **no matches anywhere**

`PUBLIC_PATHS` in `src/lib/supabase/middleware.ts:6` even whitelists `/auth`, for a route that was never written. So the user clicks the emailed link, lands on the form with no session, and `supabase.auth.updateUser({password})` fails with "Auth session missing". **Nobody can reset a forgotten password.**

### 🔴 AUTH-2 — See SEC-4 (COC gate bypass) and SEC-5 (account takeover)
Cross-referenced; counted once in the scoreboard.

### 🟠 AUTH-3 — Publishing a new COC version doesn't require anyone to re-read it
`src/app/(app)/admin/actions.ts:138` (`publishCocVersion`)

The table is versioned and the admin UI can publish version N+1, but no member's `coc_completed` is reset, and nothing records *which version* a member accepted (`coc_attempts` has no version column). So a revised code of conduct is never actually agreed to by anyone. The versioning machinery exists but achieves nothing.

### 🟠 AUTH-4 — Self-signups are never email-verified
`src/app/(auth)/signup/actions.ts:157`

`createUser({..., email_confirm: true})` marks every self-signup's email as confirmed without sending anything. Anyone can register under someone else's email address. Feeds directly into SEC-5.

### 🟡 AUTH-5 — COC quiz allows unlimited attempts with no cooldown
`src/app/coc/actions.ts`; `COC_PASS_THRESHOLD = 1.0`, `COC_QUIZ_SIZE = 4`

100% of 4 questions is required, drawn from a bank of 8 seeded questions, with unlimited retries and reshuffled options. Even with SEC-4 fixed, a member can simply retry until they pass. Consider an attempt limit or a short lockout.

### 🟡 AUTH-6 — Middleware does 2–3 DB round trips on every single request
`src/lib/supabase/middleware.ts:62,77`

Every page request runs `auth.getUser()`, then a `profiles` read for `coc_completed`, then a `user_roles` read on gated prefixes. This is on the hot path for all navigation. The role/COC state belongs in a JWT claim or a short-lived cookie.

### 🟡 AUTH-7 — Middleware role gate doesn't cover `subunit_leader` semantics
`src/lib/supabase/middleware.ts:10`

`/leader` is gated on holding the `subunit_leader` **role**, but leadership throughout the rest of the app is derived from `subunit_members.role_in_subunit = 'leader'`. The two can disagree: `setSubunitLeader` (`src/app/(app)/admin/actions.ts:36`) sets `role_in_subunit` but never grants the `subunit_leader` role. So **an admin can make someone a subunit leader and they still can't open `/leader`** — they get bounced to `/dashboard`. Confirmed inconsistency between the two sources of truth.

---

# C. Courses / LMS

### 🟠 CRS-1 — Sequential module gating is client-side only
`src/app/(app)/courses/[courseId]/course-player.tsx:96` vs `src/app/(app)/courses/actions.ts:56`

The player computes `locked` and renders `disabled={m.locked}`, but `submitModule(moduleId)` performs no check that the previous module is approved, and no check that the member is even enrolled in the course. A member can submit any module in any order by calling the action directly. Combined with SEC-2 (self-approval) the entire course progression model is advisory.

### 🟠 CRS-2 — Module reorder can corrupt positions
`src/app/(app)/leader/courses/actions.ts:163` (`moveModule`)

Three sequential un-transacted updates, using `position = -1` as a temporary:

```ts
await supabase.from("modules").update({ position: -1 }).eq("id", a.id);
await supabase.from("modules").update({ position: a.position }).eq("id", b.id);
await supabase.from("modules").update({ position: b.position }).eq("id", a.id);
```

If the second or third call fails (network, RLS, deploy mid-flight) a module is left stranded at `position = -1` — which sorts first, ahead of module 1, and blocks the next reorder on the `unique (course_id, position)` constraint. Should be one RPC / transaction.

### 🟠 CRS-3 — WhatsApp links break for locally-formatted numbers
`src/lib/utils.ts:9` (`buildWhatsAppLink`)

```ts
const normalized = whatsapp.replace(/[^\d]/g, "");
return `https://wa.me/${normalized}?text=...`;
```

`wa.me` requires a full international number. A leader whose stored number is `08031234567` produces `wa.me/08031234567`, which WhatsApp rejects. Nothing in signup, import, or the admin UI enforces or normalises to E.164 (+234…). Since WhatsApp is the *only* assignment submission channel, this silently breaks the core LMS loop for any leader who typed a local number.

### 🟡 CRS-4 — Re-applying to a course overwrites the rejection record
`src/app/(app)/courses/actions.ts:18`

`upsert` on `(user_id, course_id)` means a rejected applicant can immediately re-apply, wiping `status: 'rejected'`, `decided_by` and `decided_at`. No cooldown, no history, and the leader loses the record that they already said no.

### 🟡 CRS-5 — `MIN_MODULES_GUIDANCE` is defined but never used
`src/lib/constants.ts:21`

> `/** Guidance: warn (don't block) below this many modules per course (Section 8). */`

`grep` shows no reader. The spec'd "warn the leader if a course has fewer than 7 modules" hint was never wired into the course editor.

### 🟡 CRS-6 — Assignment approval rate is a rough proxy
`src/lib/queries.ts:45`

```ts
const rejected = (progress ?? []).filter((p) => p.rejection_note && p.status !== "approved").length;
const assignmentsDenom = approvedModules + rejected;
```

`rejection_note` is cleared on approval (`leader/actions.ts:20`), so a member who was rejected three times and then approved scores a perfect 100% on assignments. The metric only ever reflects *currently* outstanding rejections, not the actual approval history. There is no rejection count or audit table to compute it properly.

### 🟡 CRS-7 — Progress can exceed 100% and skew the composite score
`src/lib/queries.ts:42,64`; `src/lib/performance.ts:13`

`approvedModules` counts **all** of a member's `module_progress` rows with status `approved`, while `totalModules` only counts modules in *currently enrolled* courses. If a member is unenrolled, or a course is unpublished, `progress` can exceed 1. `compositeScore` does no clamping — only the display helper `pct()` clamps. So the stored/compared composite can be > 1.

---

# D. Attendance + AI ingestion

### 🔴 ATT-1 — Multi-sheet workbooks silently lose data
`src/lib/attendance-parser.ts:16` (`readSheetRows`), `:52` (`readBestRegisterMatrix`)

`readSheetRows` reads `wb.Sheets[wb.SheetNames[0]]` — **the first sheet only**. It is used by the main upload path (`secretary/attendance/actions.ts:96`), the past-attendance import (`import-attendance/actions.ts:91`) and the member import (`import-members/actions.ts:117`).

`readBestRegisterMatrix` does scan every sheet — but returns only the single highest-scoring one. So a workbook with 12 monthly register tabs imports **one month** and reports success. The commit `0ba38f0 "Import multi-sheet attendance registers"` claims this works; it does not. Confirmed by reading both functions: neither loops over sheets accumulating rows.

### 🟠 ATT-2 — Parse failures are swallowed and look like a blank sheet
`src/app/(app)/secretary/attendance/actions.ts:103`

```ts
} catch {
  // Never commit on parse error — fall back to a manual-review proposal
  proposal = { matches: [], unmatched_sheet_rows: rows.map(...), roster_not_on_sheet: roster.map(...) };
}
```

A bare `catch {}` with no logging. An invalid API key, a rate limit, a truncated tool response and a genuinely unreadable sheet all produce the identical outcome: a review screen with zero matches and every member listed as absent from the sheet. The secretary has no way to tell "the AI is misconfigured" from "your file is unreadable", and you have nothing in the logs to diagnose it.

### 🟠 ATT-3 — Whole roster + whole sheet are stuffed into one prompt with an 8k output cap
`src/lib/attendance-parser.ts:179,194`

The prompt embeds `JSON.stringify(roster)` and `JSON.stringify(rows)` in full, with `max_tokens: 8000` and no token counting, chunking, or `stop_reason` check. At a few hundred members the `matches` array alone will exceed 8000 output tokens, the tool input is truncated mid-JSON, `extractProposal` throws, and you land in ATT-2's silent fallback. There is no `strict: true` on the tool either, so the input isn't schema-validated even when it does fit.

### 🟠 ATT-4 — Wide-register import marks pre-join dates as absent
`src/app/(app)/secretary/import-attendance/actions.ts:287`

```ts
const status: AttendanceStatus = presentMarks.includes(cell) ? "present" : "absent";
```

Every blank cell becomes an explicit `absent` record — including service dates from before the member joined. Those rows then feed `recomputeMissedService`, so importing a historical register can auto-open welfare follow-ups against members who weren't yet in the team, and permanently depresses their attendance rate.

### 🟠 ATT-5 — Duplicate header dates make the whole import batch fail
`src/app/(app)/secretary/import-attendance/actions.ts:303`

`records` is built by iterating `dateCols` per member with no dedup on `(user_id, activity_id, service_date)`. Registers commonly repeat or merge a date header. If two columns resolve to the same date and activity, the chunk contains two conflicting rows and Postgres rejects the entire upsert with *"ON CONFLICT DO UPDATE command cannot affect row a second time"* — the import fails wholesale with a raw Postgres error surfaced to the secretary. Same risk for `summaries` on `(user_id, period)`.

### 🟠 ATT-6 — Date coercion drifts by a day
`src/app/(app)/secretary/import-attendance/actions.ts:41` (`coerceDate`)

```ts
const d = new Date(s);
return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
```

`new Date(s)` parses in the server's local zone, `toISOString()` converts to UTC. On any server behind UTC (and for `Date` cell values generally) this shifts the date back by one day. Attendance then lands on the wrong service date and won't match the real service. Same pattern at `:228` (`dt.toISOString()`) and in `src/lib/queries.ts:56`.

### 🟠 ATT-7 — Storage upload errors are ignored
`src/app/(app)/secretary/attendance/actions.ts:86`

```ts
await admin.storage.from("attendance").upload(storagePath, buffer, {...});
await admin.from("attendance_uploads").update({ raw_storage_path: storagePath })...
```

The upload result is never checked, yet `raw_storage_path` is written unconditionally. If storage is misconfigured or the bucket is missing, the DB claims a raw file exists at a path that holds nothing — the audit trail is silently broken. Also note the key is `attendance/<id>/<name>` *inside* the `attendance` bucket, so real paths are `attendance/attendance/…`, and `file.name` is never sanitised.

### 🟡 ATT-8 — Pinned model is previous-generation
`src/lib/constants.ts:28`

```ts
export const ATTENDANCE_PARSE_MODEL = "claude-sonnet-4-6";
```

Valid, but superseded. Sonnet 4.6 is $3/$15 per MTok against Sonnet 5 at $2/$10 — so the current pin is **both more expensive and less capable** than the obvious alternative. For handwriting-heavy register photos (ATT-9) an Opus-tier model would materially improve accuracy. Forced tool use (`tool_choice: {type:"tool"}`) is supported on 4.6 and on Opus 5 / Sonnet 5, so the call shape ports unchanged; only the newest Fable-tier models reject it.

### 🟡 ATT-9 — Register photo path accepts one image and mislabels formats
`src/lib/attendance-parser.ts:210`

Only a single image per upload, so a two-page register needs two uploads with two separate service-date entries. And an unrecognised MIME type is **relabelled** as `image/jpeg` rather than rejected:

```ts
const media = ([...].includes(mediaType) ? mediaType : "image/jpeg") as ImageMediaType;
```

A HEIC from an iPhone is declared to the API as JPEG, which fails server-side with a confusing error. No downscaling either, so a 5MB photo becomes ~6.8MB of base64 on every request.

### 🟡 ATT-10 — Imported monthly totals never count toward performance
`src/lib/queries.ts:52`; `supabase/migrations/0009_monthly_summary.sql`

`monthly_attendance_summary` is written by the wide import and displayed on the secretary page — but `getMemberPerformance` reads only `attendance_records`. Confirmed by grep: the only readers are `secretary/page.tsx:41` and the import itself. So historical attendance you took the trouble to import contributes nothing to any member's attendance score or composite.

### 🟡 ATT-11 — Committed uploads can't be corrected, discarded ones can be committed
`src/app/(app)/secretary/attendance/actions.ts:140,172`

`commitUpload` refuses only `status === "committed"`, so a **discarded** upload can still be committed. And there is no un-commit or re-review path — a mis-committed sheet can only be fixed by editing `attendance_records` directly in Supabase.

### 🟡 ATT-12 — Redundant session lookup per upload
`src/app/(app)/secretary/attendance/actions.ts:74`

`getSessionRoles()` is called by `requireSecretary()` at the top and again inline for `uploaded_by`, doubling the auth round trips (each is 3 queries). Cosmetic, but free to fix.

---

# E. Welfare

### 🔴 WEL-1 — Threshold of 0 flags every active member
`src/app/(app)/admin/actions.ts:127` (`setMissedThreshold`) → `src/lib/welfare-automation.ts:33`

`setMissedThreshold` accepts any number with no validation. With `threshold = 0`:

```ts
const recentDates = [...].slice(0, 0);          // []
if (recentDates.length < threshold) return;      // 0 < 0 is false → continues
const missedAll = recentDates.every(...);        // [].every() === true  ← always
```

`Array.every` on an empty array is `true` by definition, so **every active member is flagged** for missed service on the next commit. A negative value behaves the same way. Needs a `>= 1` clamp at both the setter and the reader.

### 🟠 WEL-2 — Only one attendance-signal activity is ever honoured, non-deterministically
`src/lib/welfare-queries.ts:75`

```ts
.eq("is_attendance_signal", true).limit(1).maybeSingle()
```

`limit(1)` with **no `order()`**. The admin UI happily lets you mark several activities as signals (`admin/actions.ts:90,108`), and then the "missed N Sundays" count on the welfare board silently picks an arbitrary one, which can change between requests. Either enforce a single signal activity in the schema or aggregate across all of them.

### 🟠 WEL-3 — Welfare escalation levels never escalate
`supabase/migrations/0001_schema.sql` (`level int check between 1 and 3`); `src/lib/welfare-automation.ts:69`

Follow-ups are always inserted at the default `level = 1`. Nothing anywhere increases the level as someone keeps missing services — the only writer is the manual dropdown in `updateFollowup`. The 3-tier escalation model exists in the schema and the UI and is never driven by the data.

### 🟠 WEL-4 — Assignment notification fires on every save
`src/app/(app)/welfare/actions.ts:44`

```ts
if (patch.assignedTo) { await notify({ ... "Welfare follow-up assigned to you" ... }); }
```

The condition is "assignedTo is present in the patch", not "assignedTo changed". Editing the notes or status of an already-assigned follow-up re-notifies the assignee every time. Needs a compare against the current value.

### 🟠 WEL-5 — Auto-flagged missed-service follow-ups notify nobody
`src/lib/welfare-automation.ts:68`

`recomputeMissedService` inserts follow-ups and sends **no notification**. Compare `syncWelfareForStatus` (`secretary/roster/actions.ts:71`), which does notify the welfare team for traveled/inactive. So the highest-volume, fully-automatic trigger is the one the welfare team never hears about — they have to remember to check the board.

### 🟡 WEL-6 — Members with no attendance record are never flagged
`src/lib/welfare-automation.ts:64`

```ts
const missedAll = recentDates.every((d) => statuses?.get(d) === "absent");
```

Requires an explicit `absent` row on every recent date. A member who simply never appears on any sheet has no rows at all and is therefore never flagged — arguably the exact person welfare most needs to know about. Defensible as "only flag what we positively know", but worth a decision.

### 🟡 WEL-7 — `graduated` / `left` don't close open follow-ups
`src/app/(app)/secretary/roster/actions.ts:41` (`syncWelfareForStatus`)

Only `traveled`, `inactive` and `active` are handled. Marking someone `graduated` or `left` leaves their welfare follow-ups open forever, cluttering the queue with people who are gone.

### 🟡 WEL-8 — Birthday windows are computed in the server's timezone
`src/lib/welfare-queries.ts:24`; `src/app/api/cron/birthdays/route.ts:19`

`new Date()`, `getMonth()`, `getDate()` all run in the server zone — UTC on Vercel. For a Nigeria-based team (UTC+1) the 06:00 UTC cron lands at 07:00 WAT the same day, so it happens to work; but there's no explicit timezone anywhere, so the correctness is coincidental and will break if the schedule or region changes.

---

# F. Secretary roster & imports

### 🔴 ROS-1 — Member deletion silently fails for anyone with activity history
`src/app/(app)/secretary/roster/actions.ts:168` (`removeMembers`); `supabase/migrations/0001_schema.sql`

```ts
for (const id of ids) {
  await admin.auth.admin.deleteUser(id);   // result never checked
}
```

Two compounding faults.

**The FK chain blocks the delete.** `profiles.id` cascades from `auth.users`, but several tables reference `profiles(id)` with **no `on delete` clause**, so they default to `NO ACTION`:

| Table | Column |
|---|---|
| `attendance_uploads` | `uploaded_by` (not null) |
| `courses` | `created_by` (not null) |
| `module_progress` | `approved_by` |
| `enrollments` | `decided_by` |
| `welfare_followups` | `assigned_to` |

So deleting anyone who has ever uploaded an attendance sheet, created a course, approved a module, decided an application, or been assigned a follow-up raises a foreign-key violation.

**And the error is discarded.** The `deleteUser` result is never inspected, so the action returns normally, `revalidatePath` runs, and the UI reports success while the member is still there. Confirmed by reading the schema — no `on delete` on any of the five columns above.

### 🟠 ROS-2 — Orphaned auth users when profile creation fails
`src/app/(app)/welfare/actions.ts:101`; `src/app/(app)/secretary/roster/actions.ts:134`

Both call `admin.auth.admin.createUser(...)`, then `admin.from("profiles").insert(...)` — and **neither checks the insert result or rolls back the auth user**. A failed insert leaves a login with no profile: invisible in every UI (they all read `profiles`), undetectable by the duplicate-email check (which reads `profiles`), but still occupying the email in `auth.users`, so the next attempt fails with a confusing "email already registered".

Note `import-members/actions.ts:238` **does** handle this correctly — it deletes the auth user on profile failure. The same pattern just wasn't applied to the two single-member paths.

### 🟠 ROS-3 — Claim matching silently caps at 1000 profiles
`src/app/(auth)/signup/actions.ts:68`

```ts
const { data: allProfiles } = await admin.from("profiles").select("id, email, phone, whatsapp_number, claimed");
```

No `limit()`, no pagination — PostgREST caps the response at 1000 rows. Past 1000 members, anyone whose profile falls outside that window won't be matched, so instead of claiming their imported record they get a **brand-new duplicate account**, losing all their attendance and course history. Same unbounded pattern at `import-attendance/actions.ts:94` and `:256` (member matching) and `welfare-automation.ts:37` (active members).

### 🟠 ROS-4 — Admin status changes skip the welfare sync
`src/app/(app)/admin/actions.ts:188` (`adminSetMemberStatus`) vs `src/app/(app)/secretary/roster/actions.ts:21` (`setMemberStatus`)

The secretary path calls `syncWelfareForStatus`; the admin path does not. So marking someone traveled or inactive opens a welfare follow-up *if a secretary does it* and silently does nothing *if the super admin does it*. Two doors, two different behaviours, no reason for the difference.

### 🟡 ROS-5 — 4-subunit cap is a hardcoded magic number, unenforced in the DB
`src/app/(app)/secretary/roster/actions.ts:215`, `:224`; `import-members/actions.ts:~197`; `signup/actions.ts:193`

`4` (and `.slice(0,3)`) appears in four places, in none of them via `constants.ts`, and there is no DB constraint. Concurrent assignments can exceed it, and changing the policy means finding all four sites.

### 🟡 ROS-6 — Birthday parsing guesses month/day order
`src/app/(app)/secretary/import-members/actions.ts:39` (`parseBirthday`)

```ts
if (a > 12 && b <= 12) [a, b] = [b, a];   // assumes month/day unless impossible
```

`"6/27"` and `"27/6"` both resolve, but a genuinely ambiguous `"6/7"` is always read as June 7th — never July 6th. Nigerian sheets are typically day/month, so this is likely backwards for the common case, and silently so.

### 🟡 ROS-7 — Seed data duplicates on re-run
`supabase/migrations/0003_seed.sql`

`activities` and `coc_questions` use `on conflict do nothing` but have **no unique constraint** on any natural key, so no conflict is ever detected and re-running the seed inserts a second copy of every activity and every question. (`subunits` is safe — it has `unique (slug)`; `code_of_conduct` is protected by the `one_active_coc` partial index.)

---

# G. Super admin

### 🟠 ADM-1 — Analytics silently cap at 1000 rows and show stale data
`src/app/(app)/admin/page.tsx:27`

```ts
const { data: attendance } = await admin
  .from("attendance_records")
  .select("service_date, status, activities(name)")
  .order("service_date", { ascending: true });     // ascending + no limit
...
const attendanceTrend = [...trendMap.entries()].map(...).slice(-12);
```

Ordered **ascending** with no limit, so PostgREST returns the *oldest* 1000 records. `.slice(-12)` then takes the last 12 of that stale window. Once you pass 1000 attendance records the trend chart **freezes and never shows recent services again**. The same unbounded reads at `:54` (`enrollments`) and `:55` (`module_progress`) make the per-subunit completion rates wrong at the same threshold. Should be `descending` + an explicit range, or a DB-side aggregate.

### 🟠 ADM-2 — `setSubunitLeader` doesn't grant the `subunit_leader` role
`src/app/(app)/admin/actions.ts:36`

See AUTH-7. It writes `role_in_subunit = 'leader'` but never inserts the matching `user_roles` row, so the new leader is blocked from `/leader` by middleware. The admin UI appears to work and the person cannot use what they were given.

### 🟠 ADM-3 — `publishCocVersion` is not atomic
`src/app/(app)/admin/actions.ts:150`

```ts
await admin.from("code_of_conduct").update({ is_active: false }).eq("is_active", true);
const { error } = await admin.from("code_of_conduct").insert({ ..., is_active: true });
```

Two statements, no transaction, against a `one_active_coc` unique partial index. If the insert fails, **no COC version is active at all** — and `src/app/coc/page.tsx` has nothing to show, so the gate breaks for every unverified member. Two concurrent publishes can also collide on the index.

### 🟠 ADM-4 — `updateSubunit` leaves a stale slug
`src/app/(app)/admin/actions.ts:81`

Updates `name` and `category` but not `slug`, while `createSubunit` derives the slug from the name. Rename "Publication" to "Media Publications" and the slug stays `publication`. Since `matchSubunit` (`import-members/actions.ts`) matches on **both** name and slug, imports keep matching the old name indefinitely — confusing rather than broken, but it will bite.

### 🟡 ADM-5 — No delete for subunits or activities
`src/app/(app)/admin/actions.ts`

`createSubunit`/`updateSubunit` and `createActivity`/`updateActivity` exist; there is no delete or archive for either. A mistyped activity is permanent and keeps appearing in the attendance upload dropdown forever.

### 🟡 ADM-6 — `slugify` can produce an empty or colliding slug
`src/app/(app)/admin/actions.ts:67`

A name of only punctuation yields `""`; two names differing only in punctuation collide on `unique (slug)`. Either way the raw Postgres error is thrown straight at the admin UI.

### 🟡 ADM-7 — COC completion rate is measured against unclaimed accounts
`src/app/(app)/admin/page.tsx:24`

`cocRate = cocDone / total` where `total` counts every profile, including imported/welfare-added members who have never logged in and can never have completed the COC. The headline compliance number is therefore permanently and misleadingly low.

---

# H. Notifications

### 🔴 NOTIF-1 — The birthday cron can never run: middleware redirects it to /login
`src/proxy.ts:9`; `src/lib/supabase/middleware.ts:6,45`

The proxy matcher excludes only `_next/static`, `_next/image`, `favicon.ico` and image extensions. I verified `/api/cron/birthdays` **is** matched, and that it is **not** in `PUBLIC_PATHS`:

```
/api/cron/birthdays          MATCHED by proxy
isPublic: false
```

So an unauthenticated request (which is exactly what Vercel Cron sends — a bearer token, no Supabase session cookie) hits `if (!user)` and gets a **307 redirect to `/login`**. The route handler body never executes.

The entire birthday reminder feature — `vercel.json` schedule, the route, the dedup marker, commit `cd80434` — is dead code in production. The welfare board's upcoming-birthday panel still works (it's a page read), but the on-the-day notification has never fired and never will until `/api` is exempted from the proxy or added to `PUBLIC_PATHS`.

### 🟠 NOTIF-2 — Cron marks the day done before sending, so failures lose the day
`src/app/api/cron/birthdays/route.ts:41`

The `birthday_notified_on` upsert happens **before** the notification inserts. If those inserts fail, the day is already marked complete and the reminder is skipped entirely — no retry, no error surfaced. There is also no locking, so two concurrent invocations can both pass the check and double-notify.

### 🟠 NOTIF-3 — All notification failures are swallowed
`src/lib/notify.ts:25`

```ts
} catch {
  // Notifications are non-critical; swallow errors.
}
```

Non-critical is a fair call, but with no logging at all you cannot distinguish "nothing to notify" from "notifications have been broken for three weeks". Given notifications are the primary signal for leaders (submissions) and welfare (flags), at least log the failure.

### 🟡 NOTIF-4 — Notifications are sent one-by-one in a loop
`src/app/(app)/welfare/actions.ts:138`; `src/app/(app)/secretary/roster/actions.ts:71`; `src/app/api/cron/birthdays/route.ts:55`

Sequential `await notify(...)` per recipient, each creating a **new admin Supabase client** (`notify` calls `createAdminClient()` every time). For a bulk status change across 50 members × 5 welfare staff that's 250 clients and 250 round trips inside one server action. Should be a single batched insert.

Also: Supabase Realtime is not wired up (README calls this a known nice-to-have), so the bell only updates on navigation.

---

# I. Scale & performance

### 🟠 PERF-1 — Leader members list is an N+1 explosion
`src/app/(app)/leader/members/page.tsx:54`

```ts
const performances = await Promise.all(unique.map((r) => getMemberPerformance(supabase, r.user_id)));
```

`getMemberPerformance` issues 4 queries per member (enrollments, modules, module_progress, attendance_records). For a 200-member subunit that is **~800 sequentially-authenticated queries on a single page load**, all through RLS. This page will time out well before the team outgrows the app.

### 🟠 PERF-2 — The 1000-row cap is systemic, not isolated
Confirmed unbounded `select()` calls on growth tables:

| File | Line | Table |
|---|---|---|
| `src/app/(auth)/signup/actions.ts` | 68 | `profiles` |
| `src/app/(app)/admin/page.tsx` | 27, 54, 55 | `attendance_records`, `enrollments`, `module_progress` |
| `src/app/(app)/admin/roles/page.tsx` | 10 | `profiles` |
| `src/app/(app)/secretary/import-attendance/actions.ts` | 94, 256 | `profiles` |
| `src/lib/welfare-automation.ts` | 37 | `profiles` |
| `src/lib/welfare-queries.ts` | 83 | `attendance_records` |
| `src/app/(app)/leader/members/[userId]/page.tsx` | 42 | `module_progress` |

Every one fails **silently** — no error, just missing rows and quietly wrong answers. `attendance_records` will cross 1000 within a few months of real use (one row per member per service).

### 🟠 PERF-3 — Trailing-absence counts computed on truncated data
`src/lib/welfare-queries.ts:83` (`getMissedCounts`)

Fetches all records for the signal activity across all queried users with no limit, then counts leading absences per user. Once the 1000-row cap bites, the newest records for later users are missing and the "missed N Sundays" badge on the welfare board is simply wrong.

### 🟡 PERF-4 — Every page recomputes performance from scratch
`src/lib/queries.ts`

No caching, no materialised view, no stored composite. The dashboard, the leader list and the member detail page each recompute the same numbers on every render.

### 🟡 PERF-5 — AI column mapping runs on every import
`src/lib/import-mapper.ts`

`mapMemberColumns`, `mapAttendanceColumns` and `mapSubunitValues` each make a fresh API call per import, even for a sheet whose layout hasn't changed since last week. Cheap per call, but it's latency and spend on a fully cacheable result (key on the header set).

### 🟡 PERF-6 — No indexes for the queries that actually run
`supabase/migrations/0001_schema.sql`

`attendance_records` is indexed on `(user_id)` and `(activity_id, service_date)`, but the hot query in `getMemberPerformance` filters `user_id = ? AND service_date >= ?` — a composite `(user_id, service_date)` would serve it directly. `welfare_followups` is indexed on `(status, reason)` while `syncWelfareForStatus` filters `reason + status + user_id`.

---

# J. Data integrity & schema

### 🟡 DATA-1 — Five FK columns lack `on delete` behaviour
See ROS-1 for the table. Beyond blocking deletion, `courses.created_by` and `attendance_uploads.uploaded_by` are `not null` with no cascade, which means **no member who has ever created a course or uploaded a sheet can ever be removed** without manual SQL. The nullable ones (`approved_by`, `decided_by`, `assigned_to`) should be `on delete set null`.

### 🟡 DATA-2 — `profiles.email` is not unique
`supabase/migrations/0001_schema.sql`

`email text not null` with no unique constraint. Uniqueness is enforced only by `auth.users` and by application-level pre-checks that read `profiles` — and those pre-checks are exactly what ROS-2's orphaned rows and ROS-3's 1000-row cap defeat. A unique index here would turn several silent-duplicate bugs into loud errors.

### 🟡 DATA-3 — No `updated_at` anywhere except `app_settings`
Every table has `created_at`; only `app_settings` tracks modification. There is no way to tell when a profile, follow-up, or course was last changed, and no audit trail for sensitive mutations (role grants, member deletion, attendance commits, status changes).

### 🟡 DATA-4 — `welfare_followups.level` is unvalidated at the app layer
`src/app/(app)/welfare/actions.ts:34`

`update.level = patch.level` passes any number through to a `check (level between 1 and 3)` constraint, surfacing a raw Postgres error rather than a friendly message.

---

# K. Platform & configuration

### 🟡 CFG-1 — `next.config.ts` is empty boilerplate
```ts
const nextConfig: NextConfig = { /* config options here */ };
```
No security headers (CSP, HSTS, `X-Frame-Options`, `Referrer-Policy`), no image domain allowlist, no `poweredByHeader: false`. For an app holding members' names, phone numbers, emails and birthdays, headers are the cheapest hardening available.

### 🟡 CFG-2 — No tests of any kind
No test runner, no test files, no CI workflow (`.github/` absent). Every finding in this document was found by reading code, because there is nothing that would have caught any of them. The AI parsing paths and the import mappers in particular are pure functions over fixtures — `readBestRegisterMatrix`, `parseBirthday`, `coerceDate`, `normalizeStatus`, `matchSubunit` are all trivially testable and all contain bugs listed above.

### 🟡 CFG-3 — README overstates completion
The phase table marks all 8 phases ✅ Done. Verified not done: the birthday cron (NOTIF-1, dead), password reset (AUTH-1, no callback route), multi-sheet import (ATT-1, single sheet), welfare escalation levels (WEL-3, never escalate), `MIN_MODULES_GUIDANCE` (CRS-5, unused), and the Phase 8 "RLS audit" (SEC-1 through SEC-3 are structural holes). Worth correcting so the doc doesn't mislead the next person.

### 🟡 CFG-4 — `PhasePlaceholder` component is dead code
`src/components/app/phase-placeholder.tsx` — defined, never imported. Safe to delete.

---

## What's actually working well

Credit where it's due — this is a genuinely well-built app in most respects:

- **`tsc --noEmit`, `eslint` and `next build` all pass clean.** No type errors, no lint errors, no build failures across ~10.5k lines; all 26 routes compile.
- **RLS is enabled on every single table**, with explicit policies and `SECURITY DEFINER` helpers that correctly avoid recursive policy evaluation. The three holes above are specific policy-scope mistakes, not a missing security model.
- **Secrets are properly server-side.** `createAdminClient` and the Anthropic key are behind `import "server-only"`; I found no path leaking either into a client bundle.
- **`coc_questions` is genuinely locked down** — `correct_option_index` is readable only by super admin under RLS, and the quiz reads/grades through the admin client, so correct answers never reach the browser. (The bypass in SEC-4 is grading logic, not a leak.)
- **Forced tool use for AI parsing is the right call** — a single tool whose `input_schema` is the exact target shape, with `tool_choice` pinning it, plus a `validateProposal` shape check. Sound pattern, correctly implemented for the pinned model.
- **AI is advisory, never authoritative.** Every AI path (attendance proposal, column mapping, subunit matching) produces a proposal a human reviews, with heuristic fallbacks when the API fails. Exactly the right architecture for this.
- **Import UX is thoughtful** — per-row skip reasons, Google Sheets link support, a "default subunit" escape hatch, and actionable top-level error messages instead of masked server errors.
- **Real-world messiness is handled** — subunit aliases, phone matching on last-10-digits, leading blank rows, a leading index column, the register living on a non-first sheet, Excel date serials rejected as corrupt month tallies. This is clearly code shaped by real files.
- **The claim-by-phone flow is a genuinely good idea** for a church context where most members are bulk-imported and won't respond to reset emails. It needs a verification step (SEC-5), not removal.

---

## My recommended order

**Before real member data goes in — the 12 reds:**

1. **SEC-1** — tighten `subunit_members_insert_self` to reject self-granted `role_in_subunit = 'leader'`. Widest hole, smallest fix.
2. **SEC-2** — split `module_progress_update` so members can't write `approved`; add a leader check to `approveModule`.
3. **SEC-4** — grade the COC quiz against a server-side issued-quiz record.
4. **SEC-3** — constrain `enrollments_insert_self` to `status = 'pending_application'`.
5. **NOTIF-1** — exempt `/api` from the proxy. One line; resurrects the whole birthday feature.
6. **AUTH-1** — add the `/auth/callback` route with `exchangeCodeForSession`. One file; makes password reset exist.
7. **ROS-1** — add `on delete` clauses + check the `deleteUser` result.
8. **WEL-1** — clamp the missed-service threshold to `>= 1`.
9. **ATT-1** — loop over all sheets in `readSheetRows` / `readBestRegisterMatrix`.
10. **SEC-6** — make `CRON_SECRET` mandatory.
11. **SEC-5** — decide explicitly on claim verification (OTP, or secretary confirmation).
12. **SEC-7 / SEC-8** — guard deletion of super admins and revocation of the last super admin.

**Then the data-correctness tier:** PERF-2 (the 1000-row cap — it makes several features quietly wrong), ATT-6 (date drift), ATT-5 (duplicate-date import failure), ATT-4 (pre-join absences), ADM-1 (frozen analytics), ROS-3, ROS-2.

**Then everything else**, guided by what you actually feel day to day.

My own strong opinion: **CFG-2 (no tests)** is the root cause behind a lot of this list. Five of the buggiest functions are pure and fixture-testable. A small test file around `coerceDate`, `parseBirthday`, `readBestRegisterMatrix`, `matchSubunit` and `normalizeStatus` would have caught ATT-1, ATT-6 and ROS-6 outright — and would stop them coming back.
