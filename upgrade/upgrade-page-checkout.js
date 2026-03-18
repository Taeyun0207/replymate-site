/**
 * ReplyMate Upgrade Page - Checkout Integration
 *
 * Add this script to your upgrade page (e.g. taeyun0207.github.io/replymate-site/upgrade/index.html)
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
 *    <script src="upgrade-page-checkout.js"></script>
 *
 * 3. Add data attributes to your upgrade buttons:
 *    <button data-replymate-plan="pro" data-replymate-billing="annual">Upgrade to Pro</button>
 *    <button data-replymate-plan="pro_plus" data-replymate-billing="annual">Upgrade to Pro+</button>
 *
 * 4. Cancel button (shown automatically for Pro/Pro+ users, or add standalone):
 *    <button data-replymate-cancel>Cancel subscription</button>
 *
 * Backend endpoints:
 * - GET /billing/me → { plan: "free"|"pro"|"pro_plus" }
 * - POST /billing/cancel-subscription → Schedules cancel at period end, returns { currentPeriodEnd, cancelAtPeriodEnd }
 */

(function () {
  "use strict";

  const BACKEND = window.REPLYMATE_BACKEND || "https://replymate-backend-bot8.onrender.com";
  const SUPABASE_URL = window.REPLYMATE_SUPABASE_URL;
  const SUPABASE_ANON = window.REPLYMATE_SUPABASE_ANON;
  const LABELS = window.REPLYMATE_LABELS || {};
  const PRODUCTION_UPGRADE_URL = window.REPLYMATE_UPGRADE_URL || "https://taeyun0207.github.io/replymate-site/upgrade/index.html";

  if (!SUPABASE_URL || !SUPABASE_ANON) {
    console.warn("[ReplyMate Upgrade] Missing REPLYMATE_SUPABASE_URL or REPLYMATE_SUPABASE_ANON");
    return;
  }

  if (/localhost|127\.0\.0\.1/i.test(window.location.hostname) && window.location.search) {
    window.location.replace(PRODUCTION_UPGRADE_URL + window.location.search + window.location.hash);
    return;
  }

  const supabase = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON);
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
      const base = (window.REPLYMATE_UPGRADE_URL || "https://taeyun0207.github.io/replymate-site/upgrade/index.html").split("?")[0];
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
      const plan = (data.plan || data.subscription?.plan || "").toLowerCase();
      let planVal = null;
      if (["free", "pro", "pro_plus"].includes(plan)) planVal = plan;
      else if (plan === "proplus") planVal = "pro_plus";
      const cancelAtPeriodEnd = !!(data.cancelAtPeriodEnd ?? data.cancel_at_period_end ?? data.subscription?.cancel_at_period_end);
      const raw = (data.billingInterval ?? data.billing_interval ?? data.interval ?? data.subscription?.interval ?? "").toLowerCase();
      let billingInterval = null;
      if (["month", "monthly"].includes(raw)) billingInterval = "monthly";
      else if (["year", "annual", "yearly"].includes(raw)) billingInterval = "annual";
      return planVal ? { plan: planVal, cancelAtPeriodEnd, billingInterval } : null;
    } catch {
      return null;
    }
  }

  const PENDING_CHECKOUT_KEY = "replymate_pending_checkout";

  async function createCheckout(plan, billingType) {
    const billing = billingType || "annual";
    const token = await getAccessToken();
    if (!token) {
      try {
        const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
        if (!isLocalhost) {
          sessionStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify({ plan, billing }));
        }
        await signInWithGoogle(plan, billing);
      } catch (err) {
        sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
        throw err;
      }
      return;
    }

    let data;
    try {
      const res = await fetch(`${BACKEND}/billing/create-checkout-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          targetPlan: plan,
          billingType: billingType || "annual"
        })
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.message || "Checkout failed");
    } catch (err) {
      if (err instanceof SyntaxError) throw new Error("Invalid response from server");
      throw err;
    }

    const url = data.checkoutUrl || data.url || data.checkout_url;
    if (url && typeof url === "string") {
      window.location.href = url;
    } else {
      throw new Error(data.error || "No checkout URL received");
    }
  }

  /** Keeps subscription (undoes cancel_at_period_end). */
  async function keepSubscription() {
    const token = await getAccessToken();
    if (!token) return null;

    const res = await fetch(`${BACKEND}/billing/keep-subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({})
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to keep subscription");
    return data;
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
    if (!isoDate) return "";
    try {
      const d = new Date(isoDate);
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

  function applyCurrentPlanCardMarker(currentPlan) {
    document.querySelectorAll(".plan-card[data-replymate-plan-type]").forEach((card) => {
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

  function applyCurrentBillingMarker(currentPlan, billingInterval) {
    if (!currentPlan || currentPlan === "free" || !billingInterval) return;
    const label = (LABELS.currentBillingBadge && LABELS.currentBillingBadge[getLang()]) || LABELS.currentBillingBadge?.en || "Current";
    document.querySelectorAll(".plan-card[data-replymate-plan-type]").forEach((card) => {
      const type = card.getAttribute("data-replymate-plan-type");
      if (type !== currentPlan) {
        card.querySelectorAll(".billing-option.current-billing").forEach((o) => {
          o.classList.remove("current-billing");
          o.removeAttribute("data-current-label");
        });
        return;
      }
      card.querySelectorAll(".billing-option").forEach((opt) => {
        const optType = opt.getAttribute("data-type");
        const isCurrent = optType === billingInterval;
        opt.classList.toggle("current-billing", isCurrent);
        opt.setAttribute("data-current-label", isCurrent ? label : "");
      });
    });
  }

  function applyCurrentPlanDisplay(currentPlan) {
    const badges = document.querySelectorAll(".current-plan-badge");
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

  function updateCurrentPlanDisplay() {
    const badge = document.querySelector(".current-plan-badge[data-current-plan]");
    if (!badge) return;
    const plan = badge.getAttribute("data-current-plan");
    if (plan) applyCurrentPlanDisplay(plan);
  }

  function applyCancelUI(currentPlan, cancelAtPeriodEnd) {
    if (!currentPlan || currentPlan === "free") return;

    const isKeepMode = !!cancelAtPeriodEnd;
    const label = isKeepMode ? (t("keepSubscription") || "Keep subscription") : (t("cancel") || "Cancel subscription");
    document.querySelectorAll("[data-replymate-plan]").forEach((btn) => {
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
    const confirmMsg = t("cancelConfirm") || "Cancel your subscription? You'll keep access until the end of your billing period.";
    if (!confirm(confirmMsg)) return;

    const token = await getAccessToken();
    if (!token) {
      await signInWithGoogle();
      return;
    }

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

  function init() {
    const upgradeBtns = document.querySelectorAll("[data-replymate-plan]");
    upgradeBtns.forEach((btn) => {
      btn.setAttribute("data-replymate-original-text", btn.textContent);
    });

    // Standalone cancel buttons
    const standaloneCancelBtns = document.querySelectorAll("[data-replymate-cancel]:not([data-replymate-plan])");

    // Handle post-purchase redirect (?success=1 or ?session_id=...)
    const params = new URLSearchParams(location.search);
    const justPurchased = params.has("success") || params.has("session_id");
    if (justPurchased) {
      const cleanUrl = location.pathname + (location.hash || "");
      if (history.replaceState) history.replaceState(null, "", cleanUrl);
      const defaultMsg = LABELS.purchaseSuccess?.en || "Thank you! Your plan has been upgraded.";
      document.querySelectorAll(".pricing").forEach((section) => {
        const lang = section.closest("[id]")?.id || "en";
        const msg = (LABELS.purchaseSuccess && LABELS.purchaseSuccess[lang]) || defaultMsg;
        const banner = document.createElement("div");
        banner.className = "purchase-success-banner";
        banner.textContent = msg;
        section.insertBefore(banner, section.firstChild);
      });
    }

    // Auto-redirect to Stripe after returning from Google sign-in
    (async () => {
      const params = new URLSearchParams(location.search);
      if (params.has("success") || params.has("session_id")) return;
      let plan = params.get("replymate_plan");
      let billing = params.get("replymate_billing") || "annual";
      if (!plan) {
        const pending = sessionStorage.getItem(PENDING_CHECKOUT_KEY);
        if (!pending) return;
        try {
          const p = JSON.parse(pending);
          plan = p.plan;
          billing = p.billing || "annual";
        } catch {
          return;
        }
      }
      if (!plan || !["pro", "pro_plus"].includes(plan)) return;
      try {
        let token = await getAccessToken();
        for (let i = 0; !token && i < 6; i++) {
          await new Promise((r) => setTimeout(r, 500));
          token = await getAccessToken();
        }
        if (token) {
          sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
          if (params.has("replymate_plan")) {
            history.replaceState(null, "", location.pathname + (location.hash || ""));
          }
          await createCheckout(plan, billing);
        } else {
          sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
          console.error("[ReplyMate Upgrade] No session after sign-in. Check Supabase Redirect URLs.");
        }
      } catch (e) {
        sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
        console.error("[ReplyMate Upgrade] Pending checkout failed", e);
        alert("Sign-in completed but something went wrong. Please try clicking Upgrade again.");
      }
    })();

    // Fetch subscription status, apply Cancel/Keep UI, show current plan, mark current plan card
    (async () => {
      const status = await getSubscriptionStatus();
      if (!status) return;
      const { plan, cancelAtPeriodEnd, billingInterval } = status;
      applyCancelUI(plan, cancelAtPeriodEnd);
      applyCurrentPlanDisplay(plan);
      applyCurrentPlanCardMarker(plan);
      applyCurrentBillingMarker(plan, billingInterval);
      document.body.setAttribute("data-replymate-plan", plan);
      document.body.setAttribute("data-replymate-billing", billingInterval || "");
    })();

    // Click handlers for upgrade buttons (which may become cancel buttons)
    upgradeBtns.forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        const plan = btn.getAttribute("data-replymate-plan");
        const billing = btn.getAttribute("data-replymate-billing") || "annual";
        if (!plan || !["pro", "pro_plus"].includes(plan)) return;

        // Require billing selection before checkout
        const card = btn.closest(".plan-card");
        const billingOptions = card?.querySelector(".billing-options");
        if (billingOptions) {
          const selected = billingOptions.querySelector(".billing-option.selected");
          if (!selected) {
            const msg = t("chooseBillingFirst") || "Please choose a plan first.";
            billingOptions.scrollIntoView({ behavior: "smooth", block: "nearest" });
            billingOptions.classList.add("billing-options-prompt");
            setTimeout(() => billingOptions.classList.remove("billing-options-prompt"), 1500);
            const toast = document.createElement("div");
            toast.className = "billing-prompt-toast";
            toast.textContent = msg;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2500);
            return;
          }
        }

        if (btn.getAttribute("data-replymate-cancel") === "true") {
          if (btn.getAttribute("data-replymate-keep") === "true") {
            await handleKeepClick(btn);
          } else {
            await handleCancelClick(btn);
          }
          return;
        }

        if (btn.classList.contains("error-state")) {
          clearButtonError(btn);
        }

        setButtonLoading(btn, true);
        try {
          await createCheckout(plan, billing);
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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  const langObserver = new MutationObserver(() => {
    updateCancelLabels();
    updateCurrentPlanDisplay();
    const plan = document.body.getAttribute("data-replymate-plan");
    const billing = document.body.getAttribute("data-replymate-billing");
    if (plan) applyCurrentPlanCardMarker(plan);
    if (plan && billing) applyCurrentBillingMarker(plan, billing);
  });
  langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
})();
