# Tagstash for Firefox

A Firefox WebExtension that saves the active tab to your [Tagstash](https://tagsta.sh) bookmark manager.

## What it does

- Signs in to your Tagstash account using email and password
- Reads the active browser tab's URL and title
- Optionally fetches page title and description from the Tagstash metadata endpoint
- Saves the page as a bookmark with comma-separated tags
- Displays a sidebar panel with your bookmarks organized by tags
- Matches the Slate / Midnight / Light theme you picked on tagsta.sh
- Edit, search, and manage bookmarks directly from the sidebar
- Includes a dashboard of your starred bookmarks and tags that you can set as your browser's start page

## Installation

Install from [Firefox Add-ons (AMO)](https://addons.mozilla.org) — search for **Tagstash**.

Or load it temporarily for development (see below).

## Features

### Popup
- Quick save of the active tab as a bookmark
- Add tags and description
- Auto-fetch page title and description
- Base URL keeps the site root with a trailing slash (for example, `https://www.google.com/`); Trim URL removes queries and fragments

### Sidebar
- Browse all your bookmarks organized by tags
- Search and filter bookmarks
- Edit bookmark details and tags directly, with the same Fetch Title, Open, Base URL, Trim URL and Fetch From Site helpers as the popup
- Mark bookmarks as favorites
- Sort by count or alphabetically
- Preferences cog for choosing whether bookmarks open in the current tab or a new tab (saved in this browser, separate from the website's own setting)
- Responsive to session changes (auto-refresh on login)

### Dashboard
- A quick launcher for starred items: starred bookmarks as tiles, then starred tags, each shown open as a card
- Non-starred tags stay hidden behind a **Show other tags** toggle (off by default, remembered in this browser)
- Starred bookmarks and each tag card have their own sort: A–Z, newest Added, or recently Updated (remembered separately in this browser)
- Hover a bookmark (or starred tile) for the same **Edit** button as the sidebar
- Large tags show their first 10 bookmarks with a "Show more" toggle
- Search box covers every bookmark, starred or not (press `/` to focus, Enter opens the top result) and Count / A–Z sort
- Paints instantly from the last saved copy, then refreshes from the API
- Open it from the popup's **Open Dashboard** button (the small copy icon inside that button copies its address); the extension's Settings page shows its address to paste into your browser's home page or startup page setting

### Theming
- Popup, sidebar, and settings follow the theme saved on your Tagstash account (Slate, Midnight, or Light)
- Change the theme on tagsta.sh and the extension picks it up the next time it talks to the API
- Signed out, it follows your browser's light/dark preference
- Matches the refreshed site's Archivo typography, flat surfaces, and shipping-tag shapes; the font is bundled locally

## Configuration

By default the extension points to `https://tagsta.sh/api`. The API base URL can be changed in **Settings** (gear icon) if needed, e.g. for local development.

## Folder layout

- `manifest.json` - Firefox WebExtension manifest
- `popup.html`, `popup.css`, `popup.js` - Extension popup UI and logic
- `sidebar.html`, `sidebar.css`, `sidebar.js` - Sidebar panel UI and logic
- `options.html`, `options.css`, `options.js` - Extension settings page
- `theme.css` - Shared Slate/Midnight/Light color tokens for all pages
- `fonts/` - Bundled Archivo variable font and its SIL Open Font License
- `lib/storage.js` - Local extension storage helpers
- `lib/theme.js` - Resolves and applies the account's theme (classic script, loaded in each page's `<head>`)
- `lib/tagstash-client.js` - Minimal API client for Tagstash

## Load temporarily in Firefox (development)

1. Open Firefox and go to `about:debugging`
2. Click **This Firefox**
3. Click **Load Temporary Add-on...**
4. Select `manifest.json` from this folder

## Privacy

See the [Tagstash Privacy Policy](https://tagsta.sh/privacy) for details on how your data is handled.

## Notes

- The popup only supports `http` and `https` pages
- Firefox internal pages (`about:*`) cannot be saved from the popup
- Changing the API base URL in settings clears the current session
- Your authentication token is stored locally in Firefox and never transmitted except to your configured API endpoint
