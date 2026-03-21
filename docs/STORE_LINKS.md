# Extension store links (Chrome vs Edge)

The site uses `js/replymate-store.js` with `window.REPLYMATE_STORE` (see `index.html` and `upgrade/index.html`).

## At launch

1. Publish to **Chrome Web Store** and copy the listing URL into `chromeWebStoreUrl`.
2. Publish to **Microsoft Edge Add-ons** and copy the listing URL into `edgeAddonsUrl`.
3. Set **`live: true`** in both HTML config blocks.

## How routing works

- If the user agent contains **`Edg/`** (Microsoft Edge), the first click target is **`edgeAddonsUrl`** when it is non-empty.
- Otherwise the target is **`chromeWebStoreUrl`** (Chrome, Brave, Opera, Arc, etc.).

If `edgeAddonsUrl` is empty, everyone gets the Chrome Web Store URL (Edge can still install from the Chrome Web Store when users allow extensions from other stores).

## Pre-launch

With **`live: false`**, store links stay disabled (`#` + `preventDefault`) and keep the “Coming in April” styling.
