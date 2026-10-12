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
| `06_undo.sql` | on request | Puts a person, or everyone, back. |

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
