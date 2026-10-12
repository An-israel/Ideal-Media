# Bringing the site in line with the official lists

Four SQL scripts. Paste each into **Supabase → SQL Editor → New query** and
click **Run**, in this order. Scripts 1 and 4 change nothing on their own.

**The file number is the order.** Run them 00, 01, 02, 03, 04, 05.

| File | Changes data? | What it does |
|---|---|---|
| `00_helpers.sql` | no | Matching functions. Run once. Safe to re-run. |
| `01_find_duplicates.sql` | **no** | Two accounts for one person. Fix these first or every total is wrong. |
| `02_fix_phones.sql` | yes | Corrects seven wrong numbers. Do this early — the phone is the key everything else matches on. |
| `03_preview.sql` | **no** | Counts, and the exact list of who would be removed. **Read this before 04.** |
| `04_remove_not_on_list.sql` | yes | Marks everyone not on the 101-name list as `left`. |
| `05_assign_subunits.sql` | yes | Replaces each unit's membership with its sheet. |
| `07_keep_subunit_people.sql` | yes | Puts back anyone a subunit sheet lists, and names who still has no account. |
| `08_social_media.sql` | yes | Social Media on its own: puts its people back and makes them primary members. Complete in itself; run it after `00`. |
| `06_undo.sql` | on request | Puts a person, or everyone, back. |

## The rule, as the department states it

> Keep anyone who is on the official members list **OR** on any subunit sheet.
> Remove only the people on **neither**.

`04` judges on the members list alone, so it removes some current subunit
members. `07` puts them back. Run `04`, then `07`, then `05`.

`07` also lists the sheet names with no account at all. Create those from the
app — **Admin → Members list**, pasting `combined-members-list.txt` — rather
than by SQL, so the login is created properly through Supabase's own API.
Then re-run `05_assign_subunits.sql`.

## Social Media arrived later

`08_social_media.sql` is the whole Social Media sheet on its own, because `05`
and `07` had already been run against the live site by the time it came in. It
needs only `00_helpers.sql` before it, does both jobs for those 20 names (puts
back anyone `04` had removed, then makes them primary members of Social Media),
and is safe to run twice. `05` and `07` now carry the same names too, so a run
from scratch gives the same result either way.

**James Chiamaka is deliberately left out.** The sheet marks him withdrawn —
"has another church" — so he is neither put back nor added to the unit.

Four names on that sheet have no surname and no number: **Ugochi**, **Vera
Chiamaka**, **Destiny**, **Cynthia**. `08` matches the first two if an account
already uses that exact name; the rest are reported as `matched_nobody` rather
than guessed at.

## Why Video Editing shows 0 on the attendance page — and why that is right

Attendance is counted **once per person, by their primary unit**. That is what
makes the department total equal the sum of the subunits. Video Editing,
Graphic Design, Welfare, Secretary and Publication are *secondary* units: their
members hold their primary membership in Production, Photography, Projection or
Social Media, and their attendance is taken there.

So a secondary unit reports nobody, and a roster built from it is empty — the
`0` was arithmetic, not lost data. Two things made it look like a fault:

1. A real bug, now fixed: `05` used to clear only `membership_type = 'secondary'`
   rows from a secondary unit, so three people left over as *primary* in Video
   Editing survived — and they were the only names its attendance page showed.
   It now clears any membership not on the sheet and demotes anyone wrongly
   primary there.
2. The page offered a submission form and a "0 outstanding" count for a unit
   that has nothing to submit. It now says *"Counted by each member's primary
   unit"* and links to **View members**, a read-only list of everyone in the
   unit with the status their primary unit recorded for them.

Giving Video Editing its own submission would count 20 people twice and stop
the department total adding up, so that is not offered.

## What "removed" means

Nobody is deleted. A removed person is marked `left`, which takes them off
every roster, attendance list and future report immediately, and — once
`0015_member_access.sql` has been run — blocks them from signing in.

Because no row is deleted, **past reports still read correctly** and anyone can
be restored with `06_undo.sql`.

## Two deliberate limits

**Accounts holding a role are not removed by `02`.** If your secretary or
welfare lead is not on the members list, removing them automatically would lock
out your own staff. `03_preview.sql` lists them separately, at the top, so you
can deal with them by name.

**A name that matches nobody is reported, never guessed.** `03` prints every
sheet line it could not resolve. Matching goes: a hand-checked spelling pair,
then phone number, then the same set of names, then one name contained in the
other — and that last one only when exactly one person fits. That is what keeps
`Agbo Amarachi Grace` from being mistaken for `Agbo Amarachi Emmanuella`.

## Spelling differences that are handled

Checked by hand; both spellings appear in `03` so you can verify them:

| Unit sheet says | Members list has |
|---|---|
| Ndudim Miracle | Ndud**u**m Chidimma Miracle |
| Iniwoke Joy**ce** ogheneyole | Iniwoke Joy Ogheneyole |
| Ezeora **Angel** | Ezeora **Evangel** Oluomachi |
| Ikeme **Ebube** | Ikeme **Ebubechukwu** Daniel |
| Philip **Kamsi** | Nwokolo **Kamsiyochukwu** Philip |
| Favour **M**mesoma | Chinanu Favour **N**mesoma |
| Agbo Amarachi **Grace** / Agbo Grace A | Agbo Amarachi **Emmanuella** |
| Owan Flourish | Owan Flourish **Worma** |

The last two were confirmed by the department rather than worked out from the
data: in both cases the middle name *and* the phone number differ between the
lists, so nothing in the data says they are one person.
