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

  /** Fetches current subscription plan. Returns "free"|"pro"|"pro_plus" or null if unknown. */
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
      if (["free", "pro", "pro_plus"].includes(plan)) return plan;
      if (plan === "proplus") return "pro_plus";
      return null;
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

  function applyCancelUI(currentPlan) {
    if (!currentPlan || currentPlan === "free") return;

    const cancelLabel = t("cancel") || "Cancel subscription";
    document.querySelectorAll("[data-replymate-plan]").forEach((btn) => {
      const plan = btn.getAttribute("data-replymate-plan");
      if (plan !== currentPlan) return;

      btn.classList.remove("primary", "secondary");
      btn.classList.add("cancel-plan");
      btn.href = "#";
      btn.style.pointerEvents = "auto";
      btn.textContent = cancelLabel;
      btn.setAttribute("data-replymate-cancel", "true");
    });
  }

  function updateCancelLabels() {
    const cancelLabel = t("cancel") || "Cancel subscription";
    document.querySelectorAll("[data-replymate-cancel=true]").forEach((btn) => {
      btn.textContent = cancelLabel;
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
        btn.textContent = t("cancel") || "Cancel subscription";
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
      btn.textContent = t("cancel") || "Cancel subscription";
    } else {
      btn.textContent = btn.getAttribute("data-replymate-original-text") || "Upgrade";
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

    // Fetch subscription status and apply Cancel UI for Pro/Pro+ subscribers
    (async () => {
      const plan = await getSubscriptionStatus();
      applyCancelUI(plan);
    })();

    // Click handlers for upgrade buttons (which may become cancel buttons)
    upgradeBtns.forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        const plan = btn.getAttribute("data-replymate-plan");
        const billing = btn.getAttribute("data-replymate-billing") || "annual";
        if (!plan || !["pro", "pro_plus"].includes(plan)) return;

        if (btn.getAttribute("data-replymate-cancel") === "true") {
          await handleCancelClick(btn);
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

  const langObserver = new MutationObserver(updateCancelLabels);
  langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
})();
