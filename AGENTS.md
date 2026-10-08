# AGENTS.md

Conventions and gotchas for working in this repo, gathered from hands-on sessions. Read this before making non-trivial changes.

## What this is

A Firefox (Manifest V3) WebExtension companion to [Tagstash](https://tagsta.sh) — the main app lives in a separate repo/checkout (`Tagstash`, sibling directory). This extension has **no build step**: no bundler, no framework, no `package.json`/`node_modules`. It's plain ES modules loaded directly by the browser via `<script type="module">` in `popup.html`/`sidebar.html`/`options.html`. Test changes by loading it unpacked (`about:debugging` → "This Firefox" → "Load Temporary Add-on..." → select `manifest.json`) — there's no `npm run dev` or test suite.

## Structure

- `popup.html`/`popup.css`/`popup.js` — the toolbar popup: log in, quick-save the active tab, edit title/description/tags/URL before saving (includes Base URL / Trim URL buttons and title/description auto-fetch).
- `sidebar.html`/`sidebar.css`/`sidebar.js` — the persistent sidebar panel: browse/search/edit/favorite all bookmarks, organized by tags. Listens for `browserApi.storage.onChanged` on the token key and reloads itself on login/logout so it never shows stale auth state. The popup's "Open Sidebar" button uses `sidebarAction.open()` in Firefox and `sidePanel.open()` in Chrome/Edge; Firefox only honors `sidebarAction.open()` inside the click handler itself, so don't put an `await` before that call. In Firefox the popup also checks `sidebarAction.isOpen()` on load and relabels the button "Close Sidebar" (calling `sidebarAction.close()`) when the sidebar is already open; Chrome's `sidePanel` can't report that, so it always says "Open Sidebar".
- `dashboard.html`/`dashboard.css`/`dashboard.js` — the Tagstash Dashboard, meant to be set as the browser start page: a read-only, full-width quick launcher for starred bookmarks and starred tags, each tag open as a card. Non-starred tags sit behind a "Show other tags" toggle that is **off by default** (the page's purpose is launching starred items); the choice is kept in `localStorage` under `dashboardShowOtherTags`. Search always covers the whole library. Each tag card also has its own A–Z / Added / Updated sort, saved per tag name as a JSON map in `localStorage` under `dashboardTagSorts` (A–Z is the default and isn't stored). The starred-bookmarks grid has the same control, stored on its own under `dashboardStarredSort` so it can't collide with a tag name. Added/Updated compare the API's `created_at`/`updated_at` strings directly; note the server bumps `updated_at` when a bookmark is starred or made private, not only on edits. It isn't registered in the manifest (no `chrome_url_overrides`); users open it from the popup's "Open Dashboard" button or paste its `runtime.getURL('dashboard.html')` address (shown on the options page) into their browser's home page setting. Firefox gives that address a per-install UUID, which is why the options page displays it. Hovering a bookmark row or starred tile shows an Edit button that opens the shared edit dialog. The popup's Open Dashboard button has a small copy-address button overlaid on its right end (a DOM sibling, since buttons can't nest). Bookmarks are plain `<a href>` links, so it ignores the sidebar's open-in-new-tab preference on purpose.
- `lib/edit-modal.js` + `edit-modal.css` — the edit-bookmark dialog shared by the sidebar and the dashboard. `createEditModal({ save, fetchMetadata })` injects the dialog markup into the page and returns `{ open, isOpen }`; each page links `edit-modal.css` after its own stylesheet. It carries the same field helpers as the popup and the website (Fetch Title, Open, Base URL, Trim URL, Fetch From Site) without icons or "i" tooltips. Change the dialog here, not in either page.
- `lib/bookmark-url.js` — `isSupportedUrl`, `normalizeBookmarkUrl`, `toBaseUrl`, `toTrimmedUrl`, shared by the popup and the edit dialog.
- `options.html`/`options.css`/`options.js` — settings page for pointing the extension at a self-hosted Tagstash instance instead of `https://tagsta.sh/api`.
- `theme.css` — the three shared palettes (`slate`, `midnight`, `light`) as CSS custom properties, linked by all three pages *before* their own stylesheet. The page stylesheets define no colors of their own; they only consume these tokens.
- `lib/theme.js` — resolves and applies the active theme.
- `lib/storage.js` — thin wrapper around `browser.storage.local` (`getSettings`/`saveApiBaseUrl`/`saveSession`/`clearSession`) for the API base URL, JWT token, and cached user object. This is the extension's equivalent of the web app's `localStorage` session persistence — same purpose, different browser API.
- `lib/tagstash-client.js` — minimal `fetch`-based client for the Tagstash REST API (Bearer JWT via `Authorization` header, same auth scheme as the web app).

Every file that touches WebExtension APIs uses `const browserApi = globalThis.browser ?? globalThis.chrome;` for Firefox/Chrome compatibility — follow that pattern rather than calling `browser.*`/`chrome.*` directly in new code.

## Keep in sync with the main Tagstash repo

This extension talks to the same backend (`functions/api/[[path]].js` in the `Tagstash` repo) and duplicates a couple of pieces of frontend logic rather than sharing code across repos:

- **`normalizeBookmarkUrl`** (in `lib/bookmark-url.js`, used by both the popup and the shared edit dialog) is a copy of the same function in `Tagstash/src/App.jsx` and `Tagstash/functions/api/[[path]].js`. It prefixes a missing `https://` and keeps a trailing slash on bare roots (`https://example.com` → `https://example.com/`); deeper paths are left alone. The **Base URL** buttons (`toBaseUrl` in the same file) rely on the same root selection via `new URL(...).origin + "/"`. If you change the normalization rules, update all three copies — see `Tagstash/AGENTS.md` for the canonical description.
- **`lib/tagstash-client.js`'s `fetchMetadata`** calls `POST /bookmarks/meta` once and reads both `response.title` and `response.description` off the same call (see `popup.js`'s fetch-title and fetch-description handlers, and `fetchInto` in `lib/edit-modal.js`). The popup first tries reading the active tab's DOM; the edit dialog always asks the server, since the bookmark being edited usually isn't the open tab. The web app instead calls two separate endpoints, `POST /bookmarks/meta` and `POST /bookmarks/meta-description`. Both hit the same `fetchSiteMetadata` server-side helper, so behavior is equivalent, but don't assume the two frontends call the API the same way when tracing a metadata-fetch bug.
- Any new Tagstash API route the popup or sidebar should use has to be added to `lib/tagstash-client.js` explicitly — there's no shared API-client package between the two repos.

## Theming: mirrors the account's theme, not a local setting

The extension has no theme picker. It renders whatever theme the signed-in user chose on tagsta.sh, which the API returns as `user.theme` (`slate` | `midnight` | `light`) from both `/auth/login` and `/auth/me`.

- `lib/theme.js` is a **classic script**, not an ES module, and is loaded from each page's `<head>` (`<script src="lib/theme.js"></script>`). Both parts matter: extension pages can't run inline scripts (CSP), and a `type="module"` script is deferred — so this is the only way to set `<html data-theme>` before first paint. It exposes `globalThis.tagstashTheme`, which the page modules read (`const themeApi = globalThis.tagstashTheme;`), the same way they read `browserApi`.
- It applies a `localStorage`-cached theme synchronously at load, then pages call `themeApi.applyUserTheme(user)` once the API answers. `applyUserTheme` ignores a missing/invalid `theme` — it's `null` for accounts that never picked one, and on self-hosted instances whose D1 hasn't had the theme migration applied. The cache is `localStorage` (synchronous) rather than `browser.storage.local` (async) purely to avoid the flash; the server value is the source of truth.
- The `storage` event listener in `lib/theme.js` re-applies the theme in *other* open extension pages, so signing in via the popup restyles an already-open sidebar without a reload.
- The sidebar fires its own `getCurrentUser()` call solely to refresh the theme — it otherwise never hits `/auth/me`. Don't "optimize" it away; without it a sidebar-only user keeps a stale theme indefinitely.
- The palettes in `theme.css` are hand-copied from `Tagstash/src/index.css` (`:root`, `:root[data-theme='midnight']`, `:root[data-theme='light']`) with aliases for the extension's token names. Archivo is bundled locally in `fonts/` with its OFL license; extension pages do not fetch fonts from Google. Shared `.tag-stock` shapes live in `theme.css`. There's no shared stylesheet across the repos — if the web app's palette changes, update `theme.css` to match.
- When adding CSS, **never hardcode a color** — every color, gradient, shadow, and overlay in `popup.css`/`sidebar.css`/`options.css` goes through a token, or it will look wrong in Light.

## Sidebar preferences: extension-local, unlike the theme

The sidebar's cog button (next to the refresh icon) toggles an inline `#prefs-panel` holding "Open bookmarks in: the current tab / a new tab". It's stored in `browser.storage.local` under `tagstash.openLinksInNewTab` via `saveOpenLinksInNewTab` in `lib/storage.js`, and it drives whether a bookmark click calls `browserApi.tabs.create` or `browserApi.tabs.update`. Default is **current tab** — the sidebar's original behavior.

The website has its own "open links in" setting, but that one lives on the account (`users.link_target`). The two are intentionally independent: don't make the sidebar read `user.link_target`, even though `theme` works that way. Preference changes are picked up live through the existing `storage.onChanged` listener, so a second sidebar (or window) restyles without a reload — note that listener also reloads the whole page on token changes, so keep new keys out of that branch.

The options page stays scoped to the API base URL. Saving there still calls `clearSession()` unconditionally, which is why sidebar-only preferences don't belong on that form.

## Dashboard cache

`dashboard.js` renders from `tagstash.homeCache` in `browser.storage.local` (`getHomeCache`/`saveHomeCache` in `lib/storage.js`) before the API answers, then refreshes and rewrites it. The key is deliberately **not** in `STORAGE_KEYS`, so `getSettings()` doesn't load the whole library every time the popup or sidebar opens. `clearSession()` removes it along with the token, so signing out (or changing the API base URL) never leaves another account's bookmarks on disk.

## Auth

`popup.js` logs in via `POST /auth/login` with email/password, stores the returned JWT + user object via `saveSession`, and every subsequent request attaches it as `Authorization: Bearer <token>`. Changing the configured API base URL in Settings clears the current session (`clearSession`) since the token is only valid for the instance that issued it.

Tokens can be revoked server-side before they expire: changing or resetting the password on the website signs out every session, including the extension's. The API answers a rejected token with 401/403, and `lib/tagstash-client.js` puts the HTTP status on the errors it throws (`error.status`) so callers can tell auth failures apart with `isAuthError`. The popup clears the session whenever `/auth/me` fails on open. The sidebar clears it only on an auth error (`handleAuthFailure`), and the token listener then reloads it into the signed-out state. Network errors and other failures keep the session and show the usual "try again" message.

## Release process

`manifest.json`'s `version` field is the source of truth for the extension version. Pushing a `v*` git tag triggers `.github/workflows/release.yml`, which zips the repo (excluding `.git`, `.github`, `README.md`, and any `*.zip`) and publishes it as a GitHub Release — it does **not** read or validate `manifest.json`'s version against the tag, so bump `manifest.json` and tag in the same change to avoid a mismatch between the release name and the shipped manifest.
