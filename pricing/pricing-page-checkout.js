/**
 * ReplyMate Upgrade Page - Checkout Integration
 *
 * Add this script to your pricing page (e.g. replymateai.app/pricing/index.html)
 * along with Supabase and the config below.
 *
 * 1. Add to your HTML <head>:
 *    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *
 * 2. Add config and this script before </body>:
 *    <script>
 *      window.REPLYMATE_BACKEND = "https://replymate-backend-bot8.onrender.com";
 *      window.REPLYMATE_SUPABASE_URL = "https://cmmoirdihefyswerkkay.supabase.co";
 *      window.REPLYMATE_SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."; // same as extension
 *    </script>
 *    <script src="pricing-page-checkout.js"></script>
 *
 * 3. Add data attributes to your upgrade buttons:
 *    <button data-replymate-plan="pro" data-replymate-billing="annual">Upgrade to Pro</button>
 *    <button data-replymate-plan="pro_plus" data-replymate-billing="annual">Upgrade to Pro+</button>
 *
 * 4. Cancel button (shown automatically for Pro/Pro+ users, or add standalone):
 *    <button data-replymate-cancel>Cancel subscription</button>
 *
 * 5. Switch button (with REPLYMATE_SWITCH_VIA_PORTAL = true, opens portal; user picks plan):
 *    <button data-replymate-switch data-replymate-plan="pro" data-replymate-billing="annual">Switch to Pro Annual</button>
 *
 * 6. Success banner (optional): Add #replymate-success-banner or [data-replymate-success-banner]
 *    to show a custom success message after checkout. If absent, a banner is created in .pricing.
 *    Globals set on success: window.REPLYMATE_CHECKOUT_SUCCESS, window.REPLYMATE_CHECKOUT_SESSION_ID
 *
 * Backend endpoints:
 * - GET /billing/me → { plan: "free"|"pro"|"pro_plus" }
 * - POST /billing/cancel-subscription → Schedules cancel at period end, returns { currentPeriodEnd, cancelAtPeriodEnd }
 *
 * Optional (Customer Portal → DB lag): set window.REPLYMATE_SYNC_BILLING_AFTER_PORTAL = true and implement
 * POST /billing/sync-subscription — backend retrieves Stripe subscription and updates DB (see docs/PAYMENT_SETUP.md).
 */

(function () {
  "use strict";

  const BACKEND = window.REPLYMATE_BACKEND || "https://replymate-backend-bot8.onrender.com";
  const KEEP_SUBSCRIPTION_PATH = window.REPLYMATE_KEEP_SUBSCRIPTION_PATH || "keep-subscription";
  const SWITCH_VIA_PORTAL = !!window.REPLYMATE_SWITCH_VIA_PORTAL;
  const SUPABASE_URL = window.REPLYMATE_SUPABASE_URL;
  const SUPABASE_ANON = window.REPLYMATE_SUPABASE_ANON;
  const LABELS = window.REPLYMATE_LABELS || {};
  const PRODUCTION_UPGRADE_URL = window.REPLYMATE_UPGRADE_URL || "https://replymateai.app/pricing/";

  /**
   * Optional: after Customer Portal, ask backend to pull latest subscription from Stripe into DB.
   * Enable with window.REPLYMATE_SYNC_BILLING_AFTER_PORTAL = true (see pricing/index.html).
   */
  async function syncSubscriptionFromStripe() {
    if (window.REPLYMATE_SYNC_BILLING_AFTER_PORTAL !== true) return false;
    const path = (window.REPLYMATE_BILLING_SYNC_PATH || "billing/sync-subscription").replace(/^\//, "");
    const token = await getAccessToken();
    if (!token) return false;
    try {
      const res = await fetch(`${BACKEND}/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({})
      });
      if (!res.ok && res.status !== 404) {
        console.warn("[ReplyMate Billing] POST /" + path + " returned", res.status);
      }
      return res.ok;
    } catch (e) {
      console.warn("[ReplyMate Billing] sync-subscription request failed", e);
      return false;
    }
  }

  if (!SUPABASE_URL || !SUPABASE_ANON) {
    console.warn("[ReplyMate Upgrade] Missing REPLYMATE_SUPABASE_URL or REPLYMATE_SUPABASE_ANON");
    return;
  }

  if (/localhost|127\.0\.0\.1/i.test(window.location.hostname) && window.location.search) {
    window.location.replace(PRODUCTION_UPGRADE_URL + window.location.search + window.location.hash);
    return;
  }

  const supabase = window.replymateSupabase || (SUPABASE_URL && SUPABASE_ANON && window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { storageKey: "replymate-auth" } }) : null);
  if (!supabase) {
    console.warn("[ReplyMate Upgrade] Supabase not loaded. Add: <script src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'></script>");
    return;
  }

  function getLang() {
    const lang = document.documentElement.lang || "en";
    return ["en", "ko", "ja", "es"].includes(lang) ? lang : "en";
  }

  function t(key, replace) {
    const map = LABELS[key];
    let str = (map && map[getLang()]) || (map && map.en) || "";
    if (replace && typeof replace === "object") {
      Object.keys(replace).forEach((k) => {
        str = str.replace(new RegExp("\\{" + k + "\\}", "g"), replace[k]);
      });
    }
    return str;
  }

  async function getAccessToken() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  }

  async function signInWithGoogle(plan, billing) {
    const isLocalhost = /localhost|127\.0\.0\.1/i.test(window.location.hostname);
    let redirectTo;
    if (window.REPLYMATE_UPGRADE_URL || isLocalhost) {
      const base = (window.REPLYMATE_UPGRADE_URL || "https://replymateai.app/pricing/").split("?")[0];
      redirectTo = plan && billing
        ? base + "?replymate_plan=" + encodeURIComponent(plan) + "&replymate_billing=" + encodeURIComponent(billing)
        : base;
    } else {
      redirectTo = window.location.origin + window.location.pathname + window.location.search;
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo }
    });
    if (error) throw error;
  }

  /** Fetches subscription status. Returns { plan, cancelAtPeriodEnd, billingInterval } or null. */
  async function getSubscriptionStatus() {
    const token = await getAccessToken();
    if (!token) return null;

    try {
      const res = await fetch(`${BACKEND}/billing/me`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!res.ok) return null;
      const data = await res.json();
      let plan = (data.plan || data.subscription?.plan || "").toLowerCase();
      let planVal = null;
      if (["free", "pro", "pro_plus"].includes(plan)) planVal = plan;
      else if (plan === "proplus") planVal = "pro_plus";
      else if (plan.includes("pro_plus") || plan.includes("proplus")) {
        planVal = "pro_plus";
        plan = plan; // keep full string for interval extraction below
      } else if (plan.includes("pro")) {
        planVal = "pro";
      }
      const cancelAtPeriodEnd = !!(
        data.cancelAtPeriodEnd ??
        data.cancel_at_period_end ??
        data.user?.cancelAtPeriodEnd ??
        data.user?.cancel_at_period_end ??
        data.subscription?.cancel_at_period_end ??
        data.subscriptionCancelAtPeriodEnd ??
        data.cancel_scheduled
      );
      const currentPeriodEnd = data.currentPeriodEnd ?? data.current_period_end ?? data.subscription?.current_period_end ?? data.subscription?.currentPeriodEnd ?? null;
      let raw = (
        data.billingInterval ?? data.billing_interval ?? data.user?.billingInterval ?? data.user?.billing_interval ??
        data.interval ??
        data.subscription?.interval ?? data.subscription?.billing_interval ?? data.subscription?.billingInterval ??
        data.subscription?.plan?.interval ??
        data.subscription?.items?.data?.[0]?.price?.recurring?.interval ??
        data.subscription?.items?.[0]?.price?.recurring?.interval ??
        data.subscription?.price?.recurring?.interval ??
        data.price?.recurring?.interval ??
        ""
      ).toLowerCase();
      if (!raw && planVal && planVal !== "free") {
        if (plan.includes("monthly") || plan.includes("month")) raw = "monthly";
        else if (plan.includes("annual") || plan.includes("yearly") || plan.includes("year")) raw = "annual";
      }
      if (!raw) {
        const priceId = (
          data.subscription?.items?.data?.[0]?.price?.id ??
          data.subscription?.items?.[0]?.price?.id ??
          data.subscription?.price?.id ??
          data.priceId ?? data.price_id ??
          ""
        ).toLowerCase();
        if (priceId.includes("monthly") || priceId.includes("month")) raw = "monthly";
        else if (priceId.includes("annual") || priceId.includes("yearly") || priceId.includes("year")) raw = "annual";
      }
      let billingInterval = null;
      if (["month", "monthly"].includes(raw)) billingInterval = "monthly";
      else if (["year", "annual", "yearly"].includes(raw)) billingInterval = "annual";
      return planVal ? { plan: planVal, cancelAtPeriodEnd, billingInterval, currentPeriodEnd } : null;
    } catch {
      return null;
    }
  }

  async function createCheckout(plan, billingType, options) {
    const billing = billingType || "annual";
    const token = await getAccessToken();
    if (!token) {
      const msg = t("signInFirst") || "Please sign in first to upgrade.";
      const toast = document.createElement("div");
      toast.className = "billing-prompt-toast";
      toast.textContent = "⚠️ " + msg;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
      return false;
    }

    const body = {
      targetPlan: plan,
      billingType: billingType || "annual"
    };
    if (options && options.subscriptionChange) body.subscriptionChange = true;

    let data;
    try {
      const res = await fetch(`${BACKEND}/billing/create-checkout-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.message || "Checkout failed");
    } catch (err) {
      if (err instanceof SyntaxError) throw new Error("Invalid response from server");
      throw err;
    }

    const url = data.checkoutUrl || data.url || data.checkout_url || data.redirectUrl || data.redirect_url || data.successUrl || data.success_url;
    if (url && typeof url === "string") {
      window.location.href = url;
    } else {
      throw new Error(data.error || data.message || "No checkout URL received");
    }
  }

  /**
   * Switch plan/billing: uses portal when REPLYMATE_SWITCH_VIA_PORTAL !== false (user picks in portal),
   * otherwise uses create-checkout-session with subscriptionChange (backend forces plan/billing).
   * For portal: pass no plan/billing so the user chooses in the portal; DB updates from webhook.
   */
  async function switchPlan(plan, billing) {
    if (SWITCH_VIA_PORTAL) {
      return createPortalSession();
    }
    return createCheckout(plan || "pro", billing || "annual", { subscriptionChange: true });
  }

  /** Opens Stripe Customer Portal for managing subscription (change billing, payment method, etc.). */
  async function createPortalSession() {
    const token = await getAccessToken();
    if (!token) return null;

    const params = new URLSearchParams(location.search);
    params.set("from_portal", "1");
    const returnUrl = location.origin + location.pathname + "?" + params.toString() + (location.hash || "");

    const res = await fetch(`${BACKEND}/billing/create-portal-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ returnUrl })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || "Failed to open billing portal");
    const url = data.url || data.portalUrl || data.portal_url || data.checkoutUrl || data.redirectUrl;
    if (url && typeof url === "string") {
      window.location.href = url;
    } else {
      throw new Error(data.error || "No portal URL received");
    }
  }

  /** Keeps subscription (undoes cancel_at_period_end). */
  async function keepSubscription() {
    const token = await getAccessToken();
    if (!token) return null;

    const paths = KEEP_SUBSCRIPTION_PATH.startsWith("http")
      ? [KEEP_SUBSCRIPTION_PATH]
      : [
          `${BACKEND}/billing/${KEEP_SUBSCRIPTION_PATH}`,
          `${BACKEND}/billing/reactivate-subscription`,
          `${BACKEND}/billing/undo-cancel`
        ];

    let lastError = null;
    for (const path of paths) {
      const res = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({})
      });

      let data = {};
      const text = await res.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          if (!res.ok) lastError = new Error(text || "Failed to keep subscription");
        }
      }
      if (res.ok) return data;
      const msg = data.error || data.message || (res.status === 404 ? (t("keepUnavailable") || "Keep subscription is not available. Contact support.") : "Failed to keep subscription");
      lastError = new Error(msg);
      if (res.status !== 404) break;
    }
    throw lastError;
  }

  /** Cancels subscription at period end. Returns { currentPeriodEnd } on success. */
  async function cancelSubscription() {
    const token = await getAccessToken();
    if (!token) {
      await signInWithGoogle();
      return null;
    }

    const res = await fetch(`${BACKEND}/billing/cancel-subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({})
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to cancel subscription");
    return data;
  }

  function formatEndDate(isoDate) {
    if (isoDate == null || isoDate === "") return "";
    try {
      let d;
      if (typeof isoDate === "number") {
        d = isoDate < 1e12 ? new Date(isoDate * 1000) : new Date(isoDate);
      } else {
        d = new Date(isoDate);
      }
      if (isNaN(d.getTime())) return "";
      return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    } catch {
      return String(isoDate);
    }
  }

  function getPlanDisplayName(plan) {
    const names = LABELS.planNames;
    if (!names || !names[plan]) return plan === "pro_plus" ? "Pro+" : (plan === "free" ? "Standard" : (plan || "Standard"));
    return (names[plan] && names[plan][getLang()]) || names[plan]?.en || plan;
  }

  function applyCurrentPlanCardMarker(currentPlan, scope) {
    const root = scope || document;
    root.querySelectorAll(".plan-card[data-replymate-plan-type]").forEach((card) => {
      const type = card.getAttribute("data-replymate-plan-type");
      const isCurrent = type === currentPlan;
      card.classList.toggle("current-plan", isCurrent);
      const badgeLabel = (LABELS.currentPlanBadge && LABELS.currentPlanBadge[getLang()]) || LABELS.currentPlanBadge?.en || "Current Plan";
      const featuredBadge = card.querySelector(".featured-badge");
      if (isCurrent) {
        if (featuredBadge) {
          featuredBadge.textContent = badgeLabel;
          featuredBadge.classList.add("current-plan-badge-card");
        } else {
          let badge = card.querySelector(".current-plan-badge-card");
          if (!badge) {
            badge = document.createElement("span");
            badge.className = "current-plan-badge-card";
            card.insertBefore(badge, card.firstChild);
          }
          badge.textContent = badgeLabel;
        }
      } else if (featuredBadge && featuredBadge.classList.contains("current-plan-badge-card")) {
        const lang = card.closest("[id]")?.id || "en";
        const defaultLabels = { en: "Most Popular", ko: "가장 인기", ja: "最も人気", es: "Más popular" };
        featuredBadge.textContent = defaultLabels[lang] || defaultLabels.en;
        featuredBadge.classList.remove("current-plan-badge-card");
      } else {
        const badge = card.querySelector(".current-plan-badge-card:not(.featured-badge)");
        if (badge) badge.remove();
      }
    });
  }

  function applyCurrentBillingMarker(currentPlan, billingInterval, scope) {
    if (!currentPlan || currentPlan === "free" || !billingInterval) return;
    const label = (LABELS.currentBillingBadge && LABELS.currentBillingBadge[getLang()]) || LABELS.currentBillingBadge?.en || "Current";
    const root = scope || document;
    root.querySelectorAll(".plan-card[data-replymate-plan-type]").forEach((card) => {
      const type = card.getAttribute("data-replymate-plan-type");
      if (type !== currentPlan) {
        card.querySelectorAll(".billing-option.current-plan-billing").forEach((o) => {
          o.classList.remove("current-plan-billing");
          o.removeAttribute("data-current-plan-label");
        });
        return;
      }
      card.querySelectorAll(".billing-option").forEach((opt) => {
        const optType = opt.getAttribute("data-type");
        const isCurrent = optType === billingInterval;
        opt.classList.toggle("current-plan-billing", isCurrent);
        opt.setAttribute("data-current-plan-label", isCurrent ? label : "");
        if (isCurrent) {
          opt.classList.add("selected");
          const input = opt.querySelector("input");
          if (input) input.checked = true;
          const cta = card.querySelector(".plan-cta.primary, .plan-cta.secondary");
          if (cta) cta.setAttribute("data-replymate-billing", optType);
        }
      });
    });
  }

  function applyCurrentPlanDisplay(currentPlan, scope) {
    const root = scope || document;
    const badges = root.querySelectorAll(".current-plan-badge");
    badges.forEach((badge) => {
      const lang = badge.getAttribute("data-lang") || "en";
      if (!currentPlan) {
        badge.classList.add("hidden");
        badge.textContent = "";
        badge.removeAttribute("data-current-plan");
        return;
      }
      badge.setAttribute("data-current-plan", currentPlan);
      const planName = (LABELS.planNames && LABELS.planNames[currentPlan] && LABELS.planNames[currentPlan][lang]) || getPlanDisplayName(currentPlan);
      const template = (LABELS.currentPlan && LABELS.currentPlan[lang]) || LABELS.currentPlan?.en || "Your current plan: {plan}";
      badge.textContent = template.replace("{plan}", planName);
      badge.classList.remove("hidden");
    });
  }

  function applyActiveUntilDisplay(cancelAtPeriodEnd, currentPeriodEnd, currentPlan, scope) {
    const root = scope || document;
    const elements = root.querySelectorAll(".active-until");
    elements.forEach((el) => {
      if (!currentPeriodEnd || !currentPlan || currentPlan === "free") {
        el.classList.add("hidden");
        el.textContent = "";
        return;
      }
      const lang = el.getAttribute("data-lang") || "en";
      const formatted = formatEndDate(currentPeriodEnd);
      let text;
      if (cancelAtPeriodEnd) {
        const template = (LABELS.cancelledAccessUntil && LABELS.cancelledAccessUntil[lang]) || LABELS.cancelledAccessUntil?.en || "Cancelled — access available until {date}";
        text = template.replace("{date}", formatted);
      } else {
        const template = (LABELS.renewsOn && LABELS.renewsOn[lang]) || LABELS.renewsOn?.en || "Renews on {date}";
        text = template.replace("{date}", formatted);
      }
      el.textContent = text;
      el.classList.remove("hidden");
    });
  }

  function updateCurrentPlanDisplay() {
    const badge = document.querySelector(".current-plan-badge[data-current-plan]");
    if (!badge) return;
    const plan = badge.getAttribute("data-current-plan");
    if (plan) applyCurrentPlanDisplay(plan);
  }

  function applyCancelUI(currentPlan, cancelAtPeriodEnd, scope) {
    if (!currentPlan || currentPlan === "free") return;

    const isKeepMode = !!cancelAtPeriodEnd;
    const label = isKeepMode ? (t("keepSubscription") || "Keep subscription") : (t("cancel") || "Cancel subscription");
    const root = scope || document;
    root.querySelectorAll("[data-replymate-plan]").forEach((btn) => {
      const plan = btn.getAttribute("data-replymate-plan");
      if (plan !== currentPlan) return;

      btn.classList.remove("primary", "secondary");
      btn.classList.add("cancel-plan");
      btn.href = "#";
      btn.style.pointerEvents = "auto";
      btn.textContent = label;
      btn.setAttribute("data-replymate-cancel", "true");
      btn.setAttribute("data-replymate-keep", isKeepMode ? "true" : "false");
    });
    updateBillingChangeButton();
  }

  /** Show portal only for paid plans (nothing to manage on Free). */
  function applyPortalButton(currentPlan) {
    const plan = (currentPlan || "free").toLowerCase();
    const show = plan === "pro" || plan === "pro_plus";
    document.querySelectorAll("[data-replymate-portal]").forEach((el) => {
      if (show) {
        el.style.setProperty("display", "inline-block", "important");
        el.style.visibility = "visible";
        el.textContent = t("manageSubscription") || "Manage subscription";
      } else {
        el.style.setProperty("display", "none", "important");
        el.style.visibility = "hidden";
      }
    });
  }

  function updateBillingChangeButton() {
    const currentPlan = document.body.getAttribute("data-replymate-plan");
    const currentBilling = document.body.getAttribute("data-replymate-billing");
    if (!currentPlan || currentPlan === "free" || !currentBilling) return;

    document.querySelectorAll("[data-replymate-plan][data-replymate-cancel=true]").forEach((btn) => {
      const plan = btn.getAttribute("data-replymate-plan");
      if (plan !== currentPlan) return;

      const card = btn.closest(".plan-card");
      const selectedOpt = card && card.querySelector(".billing-option input:checked");
      const selectedBilling = selectedOpt ? selectedOpt.closest(".billing-option").getAttribute("data-type") : null;

      if (selectedBilling && selectedBilling !== currentBilling) {
        const label = selectedBilling === "annual"
          ? (t("switchToAnnual") || "Switch to Annual")
          : (t("switchToMonthly") || "Switch to Monthly");
        btn.textContent = label;
        btn.setAttribute("data-replymate-switch-billing", "true");
        btn.classList.add("primary");
        btn.classList.remove("cancel-plan");
      } else {
        btn.removeAttribute("data-replymate-switch-billing");
        btn.classList.remove("primary");
        btn.classList.add("cancel-plan");
        const isKeep = btn.getAttribute("data-replymate-keep") === "true";
        btn.textContent = isKeep ? (t("keepSubscription") || "Keep subscription") : (t("cancel") || "Cancel subscription");
      }
    });
  }

  function updateCancelLabels() {
    document.querySelectorAll("[data-replymate-cancel=true]").forEach((btn) => {
      const isKeep = btn.getAttribute("data-replymate-keep") === "true";
      btn.textContent = isKeep ? (t("keepSubscription") || "Keep subscription") : (t("cancel") || "Cancel subscription");
    });
  }

  function setButtonLoading(btn, loading) {
    if (loading) {
      btn.classList.add("loading");
      btn.classList.remove("error-state");
      btn.style.pointerEvents = "none";
      btn.textContent = t("loading") || "Loading...";
    } else {
      btn.classList.remove("loading");
      btn.style.pointerEvents = "auto";
      if (btn.getAttribute("data-replymate-cancel") === "true") {
        const isKeep = btn.getAttribute("data-replymate-keep") === "true";
        btn.textContent = isKeep ? (t("keepSubscription") || "Keep subscription") : (t("cancel") || "Cancel subscription");
      } else {
        btn.textContent = btn.getAttribute("data-replymate-original-text") || "Upgrade";
      }
    }
  }

  function setButtonError(btn, errMsg) {
    btn.classList.remove("loading");
    btn.classList.add("error-state");
    btn.style.pointerEvents = "auto";
    btn.textContent = t("tryAgain") || "Try again";
    btn.setAttribute("data-replymate-error-msg", errMsg || "");
  }

  function clearButtonError(btn) {
    btn.classList.remove("error-state");
    if (btn.getAttribute("data-replymate-cancel") === "true") {
      const isKeep = btn.getAttribute("data-replymate-keep") === "true";
      btn.textContent = isKeep ? (t("keepSubscription") || "Keep subscription") : (t("cancel") || "Cancel subscription");
    } else {
      btn.textContent = btn.getAttribute("data-replymate-original-text") || "Upgrade";
    }
  }

  async function handleKeepClick(btn) {
    const token = await getAccessToken();
    if (!token) {
      const msg = t("signInFirstCancel") || "Please sign in first to manage your subscription.";
      const toast = document.createElement("div");
      toast.className = "billing-prompt-toast";
      toast.textContent = "⚠️ " + msg;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
      return;
    }
    setButtonLoading(btn, true);
    try {
      await keepSubscription();
      const msg = t("keepSuccess") || "Subscription continued.";
      alert(msg);
      location.reload();
    } catch (err) {
      console.error("[ReplyMate Upgrade]", err);
      const errMsg = err && err.message ? err.message : "Something went wrong. Please try again.";
      setButtonError(btn, errMsg);
    }
  }

  async function handleCancelClick(btn) {
    const token = await getAccessToken();
    if (!token) {
      const msg = t("signInFirstCancel") || "Please sign in first to manage your subscription.";
      const toast = document.createElement("div");
      toast.className = "billing-prompt-toast";
      toast.textContent = "⚠️ " + msg;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
      return;
    }

    const confirmMsg = t("cancelConfirm") || "Cancel your subscription? You'll keep access until the end of your billing period.";
    if (!confirm(confirmMsg)) return;

    setButtonLoading(btn, true);
    try {
      const data = await cancelSubscription();
      const endDate = data?.currentPeriodEnd || data?.endDate || data?.cancel_at;
      const formatted = formatEndDate(endDate);
      const msg = t("cancelSuccess", { date: formatted }) || "Subscription cancelled. You'll keep access until " + (formatted || "the end of your period") + ".";
      alert(msg);
      location.reload();
    } catch (err) {
      console.error("[ReplyMate Upgrade]", err);
      const msg = err && err.message ? err.message : "Something went wrong. Please try again.";
      setButtonError(btn, msg);
    }
  }

  /**
   * Checks URL for success params and shows the success banner.
   * Success when: success=1, switch=1, or session_id present.
   * Regular upgrade: ?success=1&session_id=cs_xxx
   * Switch (monthly↔annual): ?success=1&switch=1 (no session_id - backend updates subscription directly)
   * Sets globals: window.REPLYMATE_CHECKOUT_SUCCESS, window.REPLYMATE_CHECKOUT_SESSION_ID
   */
  function checkSuccessAndShowBanner() {
    const params = new URLSearchParams(location.search);
    const success = params.get("success") === "1";
    const switchDone = params.get("switch") === "1";
    const sessionId = params.get("session_id") || null; // present for regular checkout; absent for Switch flow
    const isSuccess = success || switchDone || !!sessionId;

    window.REPLYMATE_CHECKOUT_SUCCESS = isSuccess;
    window.REPLYMATE_CHECKOUT_SESSION_ID = sessionId;

    if (!isSuccess) return;

    const cleanUrl = location.pathname + (location.hash || "");
    if (history.replaceState) history.replaceState(null, "", cleanUrl);

    const defaultMsg = LABELS.purchaseSuccess?.en || "Thank you! Your plan has been upgraded.";
    const lang = getLang();
    const msg = (LABELS.purchaseSuccess && LABELS.purchaseSuccess[lang]) || defaultMsg;

    const existingBanner = document.getElementById("replymate-success-banner") || document.querySelector("[data-replymate-success-banner]");
    if (existingBanner) {
      existingBanner.textContent = msg;
      existingBanner.style.display = "";
      existingBanner.classList.remove("hidden");
    } else {
      document.querySelectorAll(".pricing").forEach((section) => {
        const sectionLang = section.closest("[id]")?.id || "en";
        const sectionMsg = (LABELS.purchaseSuccess && LABELS.purchaseSuccess[sectionLang]) || defaultMsg;
        const banner = document.createElement("div");
        banner.className = "purchase-success-banner";
        banner.textContent = sectionMsg;
        section.insertBefore(banner, section.firstChild);
      });
    }
  }

  function init() {
    // Ensure active section is set before any subscription UI (OAuth redirect can leave it unset)
    if (!document.querySelector(".language-content.active")) {
      document.getElementById("en")?.classList.add("active");
    }

    const upgradeBtns = document.querySelectorAll("[data-replymate-plan]");
    upgradeBtns.forEach((btn) => {
      btn.setAttribute("data-replymate-original-text", btn.textContent);
    });

    // Standalone cancel buttons
    const standaloneCancelBtns = document.querySelectorAll("[data-replymate-cancel]:not([data-replymate-plan])");

    // Standalone switch buttons: [data-replymate-switch] opens portal (user picks plan in Stripe)
    const switchBtns = document.querySelectorAll("[data-replymate-switch]");

    // Portal button: [data-replymate-portal] – shown only for Pro / Pro+ (hidden for Free)
    const portalBtns = document.querySelectorAll("[data-replymate-portal]");

    const params = new URLSearchParams(location.search);
    const justPurchased = params.get("success") === "1" || params.get("switch") === "1" || params.get("session_id");
    const fromPortal = params.get("from_portal") === "1";
    checkSuccessAndShowBanner();

    if (fromPortal && history.replaceState) {
      params.delete("from_portal");
      const clean = params.toString() ? "?" + params.toString() : location.pathname;
      history.replaceState(null, "", clean + (location.hash || ""));
    }

    // Fetch subscription status, apply Cancel/Keep UI, show current plan, mark current plan card
    const skipSubscriptionUI = /[?&]debug=2/.test(location.search);

    function applySubscriptionUI(status) {
      applyPortalButton(status?.plan || "free");
      if (!status) return;
      const { plan, cancelAtPeriodEnd, billingInterval, currentPeriodEnd } = status;
      document.body.setAttribute("data-replymate-plan", plan);
      document.body.setAttribute("data-replymate-billing", billingInterval || "");
      document.body.setAttribute("data-replymate-period-end", currentPeriodEnd || "");
      document.body.setAttribute("data-replymate-cancel-at-period-end", cancelAtPeriodEnd ? "true" : "false");
      var activeSection = document.querySelector(".language-content.active");
      if (!activeSection) {
        document.getElementById("en")?.classList.add("active");
        activeSection = document.querySelector(".language-content.active");
      }
      if (!activeSection) return;
      activeSection.style.setProperty("display", "block", "important");
      applyCancelUI(plan, cancelAtPeriodEnd, activeSection);
      applyCurrentPlanDisplay(plan, activeSection);
      applyActiveUntilDisplay(cancelAtPeriodEnd, currentPeriodEnd, plan, activeSection);
      applyCurrentPlanCardMarker(plan, activeSection);
      applyCurrentBillingMarker(plan, billingInterval, activeSection);
      updateBillingChangeButton();
    }

    (async () => {
      if (skipSubscriptionUI) return;
      if (fromPortal) {
        await syncSubscriptionFromStripe();
      }
      let status = await getSubscriptionStatus();
      applySubscriptionUI(status);
      // Defer to next frame, then again after 400ms (OAuth redirect can leave DOM in flux)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => applySubscriptionUI(status));
        setTimeout(() => applySubscriptionUI(status), 400);
      });
      const needsRefetch = justPurchased || fromPortal;
      if (needsRefetch) {
        const delays = fromPortal
          ? [1500, 3500, 6000, 10000, 15000, 25000, 40000]
          : [1500, 3500, 6000, 10000];
        delays.forEach((ms) => {
          setTimeout(async () => {
            if (fromPortal && ms >= 15000) {
              await syncSubscriptionFromStripe();
            }
            const fresh = await getSubscriptionStatus();
            applySubscriptionUI(fresh);
          }, ms);
        });
      }
    })();

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && !skipSubscriptionUI) {
        getSubscriptionStatus().then((s) => applySubscriptionUI(s));
      }
    });

    window.replymateRefreshSubscription = async function () {
      const s = await getSubscriptionStatus();
      if (s) applySubscriptionUI(s);
      return s;
    };

    // Click handlers for upgrade buttons (which may become cancel buttons)
    upgradeBtns.forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        const plan = btn.getAttribute("data-replymate-plan");
        if (!plan || !["pro", "pro_plus"].includes(plan)) return;

        if (btn.getAttribute("data-replymate-cancel") === "true") {
          if (btn.getAttribute("data-replymate-switch-billing") === "true") {
            setButtonLoading(btn, true);
            try {
              const card = btn.closest(".plan-card");
              const selectedOpt = card && card.querySelector(".billing-option input:checked");
              const targetBilling = selectedOpt ? selectedOpt.closest(".billing-option").getAttribute("data-type") : "annual";
              const result = await switchPlan(plan, targetBilling);
              if (result === null) {
                setButtonLoading(btn, false);
                const toast = document.createElement("div");
                toast.className = "billing-prompt-toast";
                toast.textContent = "⚠️ " + (t("signInFirst") || "Please sign in first.");
                document.body.appendChild(toast);
                setTimeout(() => toast.remove(), 3000);
              }
            } catch (err) {
              console.error("[ReplyMate Upgrade]", err);
              const msg = err && err.message ? err.message : "Something went wrong. Please try again.";
              setButtonError(btn, msg);
            }
            return;
          }
          if (btn.getAttribute("data-replymate-keep") === "true") {
            await handleKeepClick(btn);
          } else {
            await handleCancelClick(btn);
          }
          return;
        }

        // Check sign-in first (before billing selection)
        const token = await getAccessToken();
        if (!token) {
          const msg = t("signInFirst") || "Please sign in first to upgrade.";
          const toast = document.createElement("div");
          toast.className = "billing-prompt-toast";
          toast.textContent = "⚠️ " + msg;
          document.body.appendChild(toast);
          setTimeout(() => toast.remove(), 3000);
          return;
        }

        // Pro+ user upgrading to Pro = downgrade; open portal instead (block Stripe checkout)
        let currentPlan = document.body.getAttribute("data-replymate-plan");
        if (!currentPlan) {
          const status = await getSubscriptionStatus();
          currentPlan = status?.plan || null;
        }
        if (currentPlan === "pro_plus" && plan === "pro") {
          setButtonLoading(btn, true);
          try {
            await createPortalSession();
          } catch (err) {
            setButtonLoading(btn, false);
            setButtonError(btn, err?.message || "Something went wrong.");
          }
          return;
        }

        // Check that user has selected Monthly or Annual (billing option)
        const card = btn.closest(".plan-card");
        const selectedOption = card && card.querySelector(".billing-option input:checked");
        if (!selectedOption) {
          const msg = t("chooseBillingFirst") || "Please choose Monthly or Annual first.";
          const toast = document.createElement("div");
          toast.className = "billing-prompt-toast";
          toast.textContent = "⚠️ " + msg;
          document.body.appendChild(toast);
          setTimeout(() => toast.remove(), 3000);
          return;
        }
        const billing = selectedOption.closest(".billing-option").getAttribute("data-type") || "annual";

        if (btn.classList.contains("error-state")) {
          clearButtonError(btn);
        }

        setButtonLoading(btn, true);
        try {
          const result = await createCheckout(plan, billing);
          if (result === false) {
            setButtonLoading(btn, false);
            return;
          }
        } catch (err) {
          console.error("[ReplyMate Upgrade]", err);
          const msg = err && err.message ? err.message : "Something went wrong. Please try again.";
          setButtonError(btn, msg);
        }
      });
    });

    // Click handlers for standalone cancel buttons
    standaloneCancelBtns.forEach((btn) => {
      btn.setAttribute("data-replymate-cancel", "true");
      if (!btn.classList.contains("cancel-plan")) {
        btn.classList.add("cancel-plan");
      }
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        await handleCancelClick(btn);
      });
    });

    // Click handlers for [data-replymate-switch] – opens portal, user picks plan (no plan forced)
    switchBtns.forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        const plan = btn.getAttribute("data-replymate-plan") || "pro";
        const billing = btn.getAttribute("data-replymate-billing") || "annual";
        setButtonLoading(btn, true);
        try {
          const result = await switchPlan(plan, billing);
          if (result === null) {
            setButtonLoading(btn, false);
            const toast = document.createElement("div");
            toast.className = "billing-prompt-toast";
            toast.textContent = "⚠️ " + (t("signInFirst") || "Please sign in first.");
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
          }
        } catch (err) {
          console.error("[ReplyMate Upgrade]", err);
          const msg = err && err.message ? err.message : "Something went wrong. Please try again.";
          setButtonError(btn, msg);
        }
      });
    });

    // Click handlers for [data-replymate-portal] – Manage subscription below plan cards
    portalBtns.forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        setButtonLoading(btn, true);
        try {
          const result = await createPortalSession();
          if (result === null) {
            setButtonLoading(btn, false);
            const toast = document.createElement("div");
            toast.className = "billing-prompt-toast";
            toast.textContent = "⚠️ " + (t("signInFirst") || "Please sign in first.");
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
          }
        } catch (err) {
          console.error("[ReplyMate Upgrade]", err);
          setButtonLoading(btn, false);
          const toast = document.createElement("div");
          toast.className = "billing-prompt-toast";
          toast.textContent = "⚠️ " + (err?.message || "Something went wrong.");
          document.body.appendChild(toast);
          setTimeout(() => toast.remove(), 3000);
        }
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.replymateUpdateBillingButton = updateBillingChangeButton;
  window.replymateSwitchPlan = switchPlan;

  const langObserver = new MutationObserver(() => {
    updateCancelLabels();
    updateBillingChangeButton();
    updateCurrentPlanDisplay();
    const plan = document.body.getAttribute("data-replymate-plan");
    const billing = document.body.getAttribute("data-replymate-billing");
    const cancelAtPeriodEnd = document.body.getAttribute("data-replymate-cancel-at-period-end") === "true";
    const currentPeriodEnd = document.body.getAttribute("data-replymate-period-end") || null;
    const activeSection = document.querySelector(".language-content.active");
    const scope = activeSection || document;
    if (plan) applyCurrentPlanCardMarker(plan, scope);
    if (plan && billing) applyCurrentBillingMarker(plan, billing, scope);
    applyActiveUntilDisplay(cancelAtPeriodEnd, currentPeriodEnd, plan, scope);
    if (plan && plan !== "free") applyCancelUI(plan, cancelAtPeriodEnd, scope);
    applyPortalButton(plan || "free");
  });
  langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
})();
