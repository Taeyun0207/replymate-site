# ReplyMate Payment Setup Guide

This guide explains how to enable payments on your upgrade page (https://taeyun0207.github.io/replymate-site/upgrade/index.html).

---

## 1. Backend Checklist (already configured)

Your backend `.env` should have:

- `STRIPE_SECRET_KEY` (test mode for development)
- `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_ANNUAL`
- `STRIPE_PRICE_PRO_PLUS_MONTHLY`, `STRIPE_PRICE_PRO_PLUS_ANNUAL`
- `STRIPE_WEBHOOK_SECRET`
- `BILLING_SUCCESS_URL` / `BILLING_CANCEL_URL` → your upgrade page

Example:

```
BILLING_SUCCESS_URL=https://taeyun0207.github.io/replymate-site/upgrade/?success=1
BILLING_CANCEL_URL=https://taeyun0207.github.io/replymate-site/upgrade/
```

---

## 2. Stripe Webhook (required)

1. Go to **Stripe Dashboard** → **Developers** → **Webhooks**
2. Add endpoint: `https://replymate-backend-bot8.onrender.com/stripe/webhook`
3. Select events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
4. Copy the **Signing secret** → set as `STRIPE_WEBHOOK_SECRET` in Render env

---

## 3. Supabase Auth – Redirect URLs

1. Go to **Supabase Dashboard** → **Authentication** → **URL Configuration**
2. Under **Redirect URLs**, add:
   - `https://taeyun0207.github.io/replymate-site/upgrade/index.html`
   - `https://taeyun0207.github.io/replymate-site/**`
3. Set **Site URL** to `https://taeyun0207.github.io`

**Important:** Remove `http://localhost:*` from Redirect URLs if you're testing from the production site. The upgrade page uses `REPLYMATE_UPGRADE_URL` so that when opened from localhost, it redirects back to production after sign-in.

---

## 4. Google OAuth for Upgrade Page

The upgrade page needs Google Sign-In (same Supabase project as the extension).

1. Go to **Google Cloud Console** → **APIs & Services** → **Credentials**
2. Open your OAuth 2.0 Client ID (Web application)
3. Under **Authorized redirect URIs**, add:
   - `https://cmmoirdihefyswerkkay.supabase.co/auth/v1/callback` (if not already there)
4. Under **Authorized JavaScript origins**, add:
   - `https://taeyun0207.github.io`
   - `https://taeyun0207.github.io/replymate-site`

---

## 5. Upgrade Page Integration

Your upgrade page (`upgrade/index.html`) is already configured with:

1. **Supabase** – Google sign-in
2. **Backend** – Creates checkout session
3. **Redirect** – Sends user to Stripe checkout

### Current setup in `upgrade/index.html`

```html
<!-- In <head> -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

<!-- Before </body> -->
<script>
  window.REPLYMATE_BACKEND = "https://replymate-backend-bot8.onrender.com";
  window.REPLYMATE_SUPABASE_URL = "https://cmmoirdihefyswerkkay.supabase.co";
  window.REPLYMATE_SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
</script>
<script src="upgrade-page-checkout.js"></script>
```

### Button data attributes

The upgrade page uses these on Pro/Pro+ plan cards:

- **Pro Annual (default):** `data-replymate-plan="pro"` `data-replymate-billing="annual"`
- **Pro Monthly:** `data-replymate-plan="pro"` `data-replymate-billing="monthly"`
- **Pro+ Annual:** `data-replymate-plan="pro_plus"` `data-replymate-billing="annual"`
- **Pro+ Monthly:** `data-replymate-plan="pro_plus"` `data-replymate-billing="monthly"`

**Cancel subscription:** Shown automatically for Pro/Pro+ users. Or add a standalone button:

```html
<button data-replymate-cancel>Cancel subscription</button>
```

### Flow

1. User clicks upgrade → if not logged in, Google sign-in opens
2. After sign-in, checkout session is created
3. User is redirected to Stripe payment page
4. After payment, user returns to upgrade page with `?success=1`

**Cancel subscription:** Calls `POST /billing/cancel-subscription`. Schedules cancellation at period end; user keeps access until then.

---

## 6. Quick Option: Open Extension Popup

If you prefer not to add auth to the upgrade page, you can make the buttons open the extension popup instead:

```html
<a href="chrome-extension://YOUR_EXTENSION_ID/popup.html" target="_blank">
  Upgrade to Pro
</a>
```

Replace `YOUR_EXTENSION_ID` with your published extension ID (from Chrome Web Store → your extension → ID in URL).

**Limitation:** Only works when the user has the extension installed and clicks from a page that allows `chrome-extension://` links.

---

## 7. Backend API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/billing/create-checkout-session` | POST | Creates Stripe checkout, returns `checkoutUrl` |
| `/billing/me` | GET | Returns current plan (`free`, `pro`, `pro_plus`) |
| `/billing/cancel-subscription` | POST | Schedules cancel at period end, returns `currentPeriodEnd` |

---

## Troubleshooting

### Redirects to localhost instead of Stripe

- **Supabase:** Ensure production URLs are in Redirect URLs; remove or deprioritize localhost
- **Testing:** Use the live site (https://taeyun0207.github.io/...) instead of localhost

### "localhost refused to connect" after Google sign-in

- Remove `http://localhost:*` from Supabase Redirect URLs, or
- Add your production URL and always test from production
