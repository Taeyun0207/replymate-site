/**
 * ReplyMate — extension store links (Chrome Web Store vs Microsoft Edge Add-ons)
 *
 * Configure on the page BEFORE this script:
 *   window.REPLYMATE_STORE = {
 *     live: false,  // set true when the extension is published
 *     chromeWebStoreUrl: 'https://chromewebstore.google.com/detail/...',
 *     edgeAddonsUrl: 'https://microsoftedge.microsoft.com/addons/detail/...'  // optional until Edge listing exists
 *   };
 *
 * Mark links with data-replymate-store (usually with class cta-coming-soon until launch).
 *
 * Detection: Microsoft Edge includes "Edg/" in the user agent. Other Chromium browsers
 * (Chrome, Brave, Opera, etc.) use the Chrome Web Store URL. If edgeAddonsUrl is empty,
 * Edge users fall back to chromeWebStoreUrl (Edge can install from the Chrome Web Store
 * when "Allow extensions from other stores" is enabled).
 */
(function () {
  "use strict";

  /**
   * @param {object} [cfg] defaults to window.REPLYMATE_STORE
   * @returns {string}
   */
  function getReplyMateStoreUrl(cfg) {
    cfg = cfg || window.REPLYMATE_STORE || {};
    var ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    var chromeUrl = cfg.chromeWebStoreUrl || cfg.chromeUrl || "";
    var edgeUrl = cfg.edgeAddonsUrl || cfg.edgeUrl || "";

    if (edgeUrl && /Edg\//.test(ua)) return edgeUrl;
    if (chromeUrl) return chromeUrl;
    return edgeUrl || "#";
  }

  function initReplyMateStoreLinks() {
    var cfg = window.REPLYMATE_STORE || {};
    var els = document.querySelectorAll("[data-replymate-store]");

    if (!cfg.live) {
      els.forEach(function (el) {
        el.addEventListener("click", function (e) {
          e.preventDefault();
        });
      });
      return;
    }

    var url = getReplyMateStoreUrl(cfg);
    if (!url || url === "#") {
      console.warn("[ReplyMate] REPLYMATE_STORE.live is true but no store URL is set.");
      return;
    }

    els.forEach(function (el) {
      el.setAttribute("href", url);
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
      el.classList.remove("cta-coming-soon");
      el.removeAttribute("aria-disabled");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initReplyMateStoreLinks);
  } else {
    initReplyMateStoreLinks();
  }

  window.getReplyMateStoreUrl = function () {
    return getReplyMateStoreUrl(window.REPLYMATE_STORE);
  };
  window.initReplyMateStoreLinks = initReplyMateStoreLinks;
})();
