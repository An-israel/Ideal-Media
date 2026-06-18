# Going live — a step-by-step guide (no coding required)

This walks you from the code on GitHub to a real website anyone can use. It
takes about 20–30 minutes. You'll create two free accounts (Supabase for the
database, Vercel for the website), copy a few keys between them, and click
Deploy.

You will need:
- The GitHub account that holds this project (`An-israel/Ideal-Media`).
- An email address.
- ~20 minutes.

Keep a blank notes file open — you'll copy 4 secret values into it along the
way, then paste them into Vercel at the end.

---

## Part 1 — Create the database (Supabase)

1. Go to **https://supabase.com** and click **Start your project** → sign in
   with GitHub.
2. Click **New project**.
   - **Name:** `ideal-media`
   - **Database Password:** click *Generate a password* and let it save — you
     won't need to type it again.
   - **Region:** pick the one closest to your members.
   - Click **Create new project** and wait ~2 minutes while it sets up.
3. When it's ready, open the **SQL Editor** (left sidebar, the `</>` icon) →
   **New query**.
4. Open the file **`supabase/setup.sql`** from this project, copy **everything**
   in it, paste it into the editor, and click **Run** (bottom right).
   - You should see "Success. No rows returned." That means the whole database —
     tables, security rules, and starter data — is built. ✅
5. Now collect your 3 Supabase keys. Go to **Project Settings** (gear icon) →
   **API**, and copy these into your notes file:
   - **Project URL** → label it `NEXT_PUBLIC_SUPABASE_URL`
   - **`anon` `public` key** → label it `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **`service_role` `secret` key** → label it `SUPABASE_SERVICE_ROLE_KEY`
     (this one is powerful — never share it or put it in a public place)

---

## Part 2 — Get an AI key (Anthropic)

The attendance feature uses AI to read uploaded sheets. You need one key.

1. Go to **https://console.anthropic.com** → sign up / sign in.
2. Add a little credit under **Billing** (a few dollars is plenty to start).
3. Go to **API Keys** → **Create Key**, name it `ideal-media`, and copy it into
   your notes file labelled `ANTHROPIC_API_KEY`.

---

## Part 3 — Put the website online (Vercel)

1. Go to **https://vercel.com** → **Sign up** with GitHub.
2. Click **Add New… → Project**.
3. Find **`Ideal-Media`** in the list and click **Import**.
   (If you don't see it, click *Adjust GitHub App Permissions* and give Vercel
   access to the repository.)
4. **Before clicking Deploy**, open the **Environment Variables** section and add
   these five (Name on the left, the value from your notes on the right):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | your Supabase Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your Supabase anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | your Supabase service_role key |
   | `ANTHROPIC_API_KEY` | your Anthropic key |
   | `NEXT_PUBLIC_APP_URL` | leave blank for now — we fill this in Part 4 |

5. Click **Deploy** and wait a couple of minutes. You'll get a live URL like
   `https://ideal-media-xxxx.vercel.app`. 🎉

---

## Part 4 — Two quick finishing touches

**a) Tell the app its own address.**
1. Copy your new Vercel URL.
2. In Vercel: **Settings → Environment Variables**, set `NEXT_PUBLIC_APP_URL` to
   that URL (e.g. `https://ideal-media-xxxx.vercel.app`).
3. Go to **Deployments → … (top-right of the latest one) → Redeploy**.

**b) Let logins work smoothly in Supabase.**
1. In Supabase: **Authentication → URL Configuration**.
2. Set **Site URL** to your Vercel URL.
3. Under **Redirect URLs**, add your Vercel URL with `/reset-password` on the
   end, e.g. `https://ideal-media-xxxx.vercel.app/reset-password`. Save.

---

## Part 5 — Make yourself the director (super admin)

The first person to sign up is just a normal member. To unlock the admin panel:

1. Open your live site, click **Sign up**, and create your account (you'll go
   through the Code of Conduct quiz once).
2. In Supabase: **Authentication → Users**, find your email, and copy your
   **User UID**.
3. In Supabase **SQL Editor**, run this (paste your UID where shown):

   ```sql
   insert into user_roles (user_id, role)
   values ('PASTE-YOUR-USER-UID-HERE', 'super_admin');
   ```

4. Refresh the site — you'll now see the **Admin** area in the sidebar. From
   there you can promote subunit leaders, the secretary, and the welfare team.

That's it — you're live. Share the Vercel URL with your team and they can sign
up.

---

## If something looks wrong

- **The page says "Application error" right after deploy:** an environment
  variable is probably missing or has a typo. Re-check the five values in
  Vercel → Settings → Environment Variables, then Redeploy.
- **"Success. No rows returned" didn't appear in Supabase:** scroll up in the
  SQL editor for a red error. The most common cause is running it twice — the
  setup is meant to run once on a fresh project.
- **Forgot-password emails don't arrive:** Supabase's built-in email is rate-
  limited for testing. For real use, connect your own email provider under
  Supabase → Authentication → Emails (optional; everything else works without
  it).
- **Need to change the AI cost/quality:** the model is set in
  `src/lib/constants.ts` (`ATTENDANCE_PARSE_MODEL`).
