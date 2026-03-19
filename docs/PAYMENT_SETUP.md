# ReplyMate Payment Setup Guide

This guide explains how to enable payments on your upgrade page (https://replymateai.app/upgrade/index.html).

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
BILLING_SUCCESS_URL=https://replymateai.app/upgrade/?success=1
BILLING_CANCEL_URL=https://replymateai.app/upgrade/
```

---

## 2. Stripe Webhook (required)

1. Go to **Stripe Dashboard** → **Developers** → **Webhooks**
2. Add endpoint: `https://replymate-backend-bot8.onrender.com/stripe/webhook`
3. Select events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
4. Copy the **Signing secret** → set as `STRIPE_WEBHOOK_SECRET` in Render env

**Portal sync:** When users change/cancel/reactivate in the Stripe Customer Portal, Stripe sends `customer.subscription.updated` or `customer.subscription.deleted`. Your webhook must update the user's plan in your DB so `/billing/me` returns the correct data. The frontend refetches when the user returns from the portal.

### Backend webhook implementation (required for cancel/sync)

If cancellations or portal changes are not reflected in your app, your webhook handler is not updating the DB. Implement the following:

**`customer.subscription.updated`** – Fired when user cancels (at period end), reactivates, or changes plan:

**Important:** When a user cancels from the portal, Stripe sets `cancel_at_period_end: true` but keeps `status: "active"` until the period ends. You must handle this case – update your DB with `cancelAtPeriodEnd: true` so `/billing/me` returns it. Otherwise the UI will still show "Renews on..." instead of "Cancelled — access until...".

```js
// In your webhook handler:
const sub = event.data.object;
const customerId = sub.customer;
const status = sub.status;           // 'active', 'canceled', 'past_due', etc.
const cancelAtPeriodEnd = !!sub.cancel_at_period_end;
const currentPeriodEnd = sub.current_period_end;  // Unix timestamp

// Look up user by Stripe customer ID (from your DB)
const user = await findUserByStripeCustomerId(customerId);
if (!user) return;

if (status === 'canceled' || status === 'unpaid') {
  // Subscription ended – downgrade to free
  await updateUserPlan(user.id, 'free', null, null);
} else if (status === 'active') {
  // Map price ID to plan (pro/pro_plus) and interval (monthly/annual)
  const priceId = sub.items?.data?.[0]?.price?.id;
  const { plan, billing } = mapPriceToPlan(priceId);
  const periodEndIso = currentPeriodEnd ? new Date(currentPeriodEnd * 1000).toISOString() : null;
  // MUST persist cancelAtPeriodEnd so /billing/me returns it – this is the cancel-at-period-end case
  await updateUserPlan(user.id, plan, billing, periodEndIso, cancelAtPeriodEnd);
}
```

**`customer.subscription.deleted`** – Fired when subscription is fully canceled/ended:

```js
const sub = event.data.object;
const customerId = sub.customer;
const user = await findUserByStripeCustomerId(customerId);
if (user) await updateUserPlan(user.id, 'free', null, null);
```

**`/billing/me`** must read from your DB (not Stripe directly) and return:
- `plan`: `"free"` | `"pro"` | `"pro_plus"`
- `cancelAtPeriodEnd`: boolean
- `billingInterval`: `"monthly"` | `"annual"`
- `currentPeriodEnd`: ISO date string

---

## 3. Supabase Auth – Redirect URLs (required)

**If you get redirected to localhost after Google sign-in, fix this in Supabase:**

1. Go to **Supabase Dashboard** → **Authentication** → **URL Configuration**
2. Set **Site URL** to `https://replymateai.app` (or `https://replymateai.app/upgrade/index.html`)
3. Under **Redirect URLs**, add:
   - `https://replymateai.app/upgrade/index.html`
   - `https://replymateai.app/` (homepage login)
   - `https://replymateai.app/**`
4. **Remove** `http://localhost:3000` and any other localhost URLs from Redirect URLs

**Site URL** is the fallback when Supabase rejects the redirect. If it's set to localhost, you'll land on localhost after sign-in. Set it to production.

**Homepage login:** Users can sign in on the homepage first; the session is shared with the upgrade page (same origin). Ensure `https://replymateai.app/` is in Redirect URLs.

---

## 4. Google OAuth for Upgrade Page

The upgrade page needs Google Sign-In (same Supabase project as the extension).

1. Go to **Google Cloud Console** → **APIs & Services** → **Credentials**
2. Open your OAuth 2.0 Client ID (Web application)
3. Under **Authorized redirect URIs**, add:
   - `https://cmmoirdihefyswerkkay.supabase.co/auth/v1/callback` (if not already there)
4. Under **Authorized JavaScript origins**, add:
   - `https://replymateai.app`

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

**Manage subscription:** A "Manage subscription" button appears below the plan cards for all users (free, Pro, Pro+). It opens the Stripe Customer Portal. For portal changes (cancel, reactivate, switch plan) to sync with your system, your backend must handle Stripe webhooks (`customer.subscription.updated`, `customer.subscription.deleted`) and update the user's plan in your DB. The frontend refetches subscription status when returning from the portal and when the tab gains focus.

**Cancel subscription:** Shown automatically for Pro/Pro+ users. Or add a standalone button:

```html
<button data-replymate-cancel>Cancel subscription</button>
```

**Switch plan (portal):** With `REPLYMATE_SWITCH_VIA_PORTAL = true`, add a button that opens the portal so the user picks their plan:

```html
<button data-replymate-switch data-replymate-plan="pro" data-replymate-billing="annual">Switch to Pro Annual</button>
```

The `data-replymate-plan` and `data-replymate-billing` are ignored when using the portal; the user chooses in Stripe. Programmatic: `window.replymateSwitchPlan(plan, billing)`.

### Success banner (optional)

After checkout (regular upgrade or Switch monthly↔annual), the page shows a success message. You can either:

1. **Let the script create it** – A banner is automatically inserted into each `.pricing` section.
2. **Use your own element** – Add an element with `id="replymate-success-banner"` or `data-replymate-success-banner`; the script will populate it and show it on success:

```html
<div id="replymate-success-banner" class="purchase-success-banner" style="display:none;"></div>
```

Globals set on success (for optional use, e.g. fetching Stripe session details):

- `window.REPLYMATE_CHECKOUT_SUCCESS` – `true` when `success=1`, `switch=1`, or `session_id` is present
- `window.REPLYMATE_CHECKOUT_SESSION_ID` – Stripe session ID (present for regular checkout; `null` for Switch flow)

### Flow

**Regular upgrade:** User clicks upgrade → sign-in (if needed) → Stripe Checkout → returns with `?success=1&session_id=cs_xxx`

**Switch (monthly↔annual):** User selects different billing on current plan → backend updates subscription → returns with `?success=1&switch=1` (no `session_id`)

Both flows trigger the success banner. The page refetches subscription status at 1.5s, 3.5s, and 6s after a purchase to pick up webhook updates (Stripe may not have synced immediately). Call `window.replymateRefreshSubscription()` to manually refresh.

**Cancel subscription:** Calls `POST /billing/cancel-subscription`. Schedules cancellation at period end; user keeps access until then. The button then changes to **Keep subscription**; clicking it calls `POST /billing/keep-subscription` to reactivate.

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
| `/billing/create-checkout-session` | POST | Creates Stripe checkout, returns `checkoutUrl`. Body: `{ targetPlan, billingType }`. For Switch billing: `{ subscriptionChange: true }` — backend should update existing subscription to new price. |
| `/billing/me` | GET | Returns `plan`, `cancelAtPeriodEnd`, **`billingInterval`** (`monthly`/`annual`), and **`currentPeriodEnd`** (ISO date) — shown as "Renews on [date]" when active, or "Cancelled. Active until [date]" when cancelled |
| `/billing/cancel-subscription` | POST | Schedules cancel at period end, returns `currentPeriodEnd` |
| `/billing/keep-subscription` | POST | Reactivates subscription (removes cancel-at-period-end) |
| `/billing/create-portal-session` | POST | Creates Stripe Customer Portal session for managing subscription (change monthly↔annual, payment method, cancel). Body: `{ returnUrl }`. Returns `{ url }`. |

---

## Troubleshooting

### Redirects to localhost instead of Stripe

- **Supabase:** Ensure production URLs are in Redirect URLs; remove or deprioritize localhost
- **Testing:** Use the live site (https://replymateai.app/...) instead of localhost

### "localhost refused to connect" after Google sign-in

- Remove `http://localhost:*` from Supabase Redirect URLs, or
- Add your production URL and always test from production

### Cancellation not updating / user remains on plan

**Cause:** The backend webhook is not updating the DB when Stripe sends `customer.subscription.updated` or `customer.subscription.deleted`.

**Common mistake:** When a user cancels from the portal, Stripe sends `customer.subscription.updated` with `status: "active"` and `cancel_at_period_end: true` – the subscription is NOT `"canceled"` yet. If your handler only does something when `status === "canceled"`, it will ignore this event. You must handle `status === "active"` and persist `cancelAtPeriodEnd` and `currentPeriodEnd` so `/billing/me` returns them.

**Fix:** In the `status === "active"` branch, call your update function with `cancelAtPeriodEnd` and `currentPeriodEnd`. Ensure `/billing/me` reads these from your DB and returns `cancelAtPeriodEnd` and `currentPeriodEnd` in the response.

### Subscription data not updating after purchase or portal changes

- The page refetches subscription status at 1.5s, 3.5s, 6s, 10s after a purchase or when returning from the Stripe Customer Portal. It also refetches when the tab gains focus (`visibilitychange`).
- Ensure your webhook handles `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted` and updates the user's plan in your DB.
- `/billing/me` must return the updated `plan`, `billingInterval`, and `currentPeriodEnd` from your DB (not cached).
- Manually refresh: `window.replymateRefreshSubscription()` in the console.

### Monthly/Annual option has no green border

- Ensure `/billing/me` returns `billingInterval` (`"monthly"` or `"annual"`) or `interval` (`"month"` or `"year"`).
- Alternatively, include the full Stripe subscription with `subscription.items.data[0].price.recurring.interval` or a `priceId` containing "monthly"/"annual".

### "Keep subscription" button shows error

- Ensure your backend implements `POST /billing/keep-subscription` to reactivate a cancelled subscription (set Stripe `cancel_at_period_end` to false).
- The endpoint should return 200 with optional JSON; empty response is supported.
- If your backend uses a different path (e.g. `reactivate-subscription`), set `window.REPLYMATE_KEEP_SUBSCRIPTION_PATH = "reactivate-subscription"` before loading the checkout script. The frontend will also try `reactivate-subscription` and `undo-cancel` if `keep-subscription` returns 404.

### Switch button updates wrong plan in database

If the Switch button forces a plan before the user chooses in the portal, ensure `REPLYMATE_SWITCH_VIA_PORTAL = true`. With the portal flow, the frontend opens the Stripe Customer Portal **without** passing plan/billing; the user picks in the portal and the DB is updated from the `customer.subscription.updated` webhook. Without the portal, the frontend calls `create-checkout-session` with `subscriptionChange: true` and the button's plan, which updates the subscription before the user reaches the portal.

### Switch button doesn't redirect

If "Switch to Annual" or "Switch to Monthly" does nothing or shows an error:

1. **Use Stripe Customer Portal** – Add `window.REPLYMATE_SWITCH_VIA_PORTAL = true` before the checkout script. The Switch button will then call `POST /billing/create-portal-session` and redirect to Stripe's hosted billing page. Ensure your backend implements this endpoint.
2. **Check backend response** – For `create-checkout-session` with `subscriptionChange: true`, the backend must return `checkoutUrl` (or `url`, `redirectUrl`, etc.) in the JSON response.
3. **Console** – Open DevTools (F12) → Console and look for errors when clicking Switch.

### Changing Monthly ↔ Annual within the same plan

When a user on Pro Monthly selects Pro Annual (or vice versa) in their current plan card, the button changes to **"Switch to Annual"** or **"Switch to Monthly"**. By default (with `REPLYMATE_SWITCH_VIA_PORTAL = true`), clicking it opens the Stripe Customer Portal. Otherwise it sends `POST /billing/create-checkout-session` with `{ targetPlan, billingType, subscriptionChange: true }`.

**Backend implementation (recommended):** When `subscriptionChange: true`, update the existing subscription via Stripe API instead of creating a new checkout:

1. **Authenticate** the user (JWT from `Authorization` header).
2. **Find the subscription** – look up the user's Stripe customer ID (from your DB or Stripe), then list subscriptions:
   ```js
   const subscriptions = await stripe.subscriptions.list({ customer: stripeCustomerId, status: 'active' });
   const sub = subscriptions.data[0];
   const itemId = sub.items.data[0].id;
   ```
3. **Map to new price ID** – from `targetPlan` + `billingType`:
   - Pro + monthly → `STRIPE_PRICE_PRO_MONTHLY`
   - Pro + annual → `STRIPE_PRICE_PRO_ANNUAL`
   - Pro+ + monthly → `STRIPE_PRICE_PRO_PLUS_MONTHLY`
   - Pro+ + annual → `STRIPE_PRICE_PRO_PLUS_ANNUAL`
4. **Update the subscription**:
   ```js
   await stripe.subscriptions.update(sub.id, {
     items: [{ id: itemId, price: newPriceId }],
     proration_behavior: 'always_invoice'  // charge proration immediately
   });
   ```
5. **Return success URL** – frontend expects `checkoutUrl` to redirect:
   ```js
   return res.json({ checkoutUrl: process.env.BILLING_SUCCESS_URL + '?success=1&switch=1' });
   ```

Stripe will charge the prorated amount to the card on file. If payment fails, the subscription may go to `past_due`; your webhook should handle `customer.subscription.updated`.

**Alternative: Stripe Customer Portal** – If you prefer a Stripe-hosted page where users change billing themselves, implement `POST /billing/create-portal-session`:

```js
const session = await stripe.billingPortal.sessions.create({
  customer: stripeCustomerId,
  return_url: req.body.returnUrl || process.env.BILLING_SUCCESS_URL
});
return res.json({ url: session.url });
```

Then enable the frontend to use the Portal for Switch by adding before the checkout script:

```html
<script>window.REPLYMATE_SWITCH_VIA_PORTAL = true;</script>
```

This makes the "Switch to Annual/Monthly" button redirect to Stripe's Customer Portal instead of calling `create-checkout-session`.

---

## 8. Shared Auth: Homepage, Upgrade Page & Extension Popup

The homepage and upgrade page share the same Supabase session via `storageKey: "replymate-auth"`. Signing in on one automatically signs you in on the other (same origin).

**Extension popup sync:** To share auth with the Chrome extension popup:

1. **Content script** on `*://replymateai.app/*` (and localhost for dev)
2. On load: read session from `localStorage.getItem("replymate-auth")` (or Supabase’s actual key, e.g. `sb-*-auth-token`) and send to background via `chrome.runtime.sendMessage`
3. Background stores in `chrome.storage.sync`
4. Popup reads from `chrome.storage.sync` and initializes Supabase with that session
5. **Reverse (popup → website):** When user logs in on popup, store session in `chrome.storage`. When user visits the website, content script reads from `chrome.storage` and writes to the page’s `localStorage` so the website sees the session.
