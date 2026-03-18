# Fix: "localhost refused to connect" after Google sign-in

If you see this error after signing in with Google, **Supabase is redirecting to localhost** instead of your production upgrade page.

## Fix in Supabase Dashboard

1. Go to **Supabase Dashboard** → **Authentication** → **URL Configuration**
2. **Site URL**: Set to `https://replymateai.app` (or your main domain)
   - If it's `http://localhost:xxxx`, change it to production
3. **Redirect URLs**: Add these (one per line):
   - `https://replymateai.app/upgrade/index.html`
   - `https://replymateai.app/**`
4. **Remove** any `http://localhost:*` entries from Redirect URLs if you're not testing locally
5. Click **Save**

## Verify

After saving, try the upgrade flow again. You should land on the production upgrade page after sign-in, not localhost.
