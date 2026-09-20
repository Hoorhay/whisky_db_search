---
name: pwa-cache
description: >-
  Use this skill when the user asks about service worker behavior, offline
  support, PWA caching strategy, cache invalidation, debugging fetch or
  cache issues, or making changes to sw.js in the whisky_db_search project.
---

# PWA / Service Worker & Offline Debugging Guide

This app is a fully offline-capable PWA. The service worker (`sw.js`) uses a **stale-while-revalidate** strategy for app shell assets and passes all cross-origin (Firebase) requests directly to the network.

## Architecture Summary

| Layer | File | Role |
|---|---|---|
| Service Worker cache | `sw.js` | Caches app shell assets; answers page navigations from cache |
| Data cache (IndexedDB) | `app.js` → `idbGet`/`idbPut` | Persists the whisky list between sessions |
| Data cache (fallback) | `app.js` → `localStorage` | Used when IndexedDB is unavailable; migrated to IDB on first read |

## Key Constants in `sw.js`

- **`CACHE_NAME`** — Version string (e.g. `whisky-db-v3`). Bump this whenever any cached file changes.
- **`CORE_ASSETS`** — Files that *must* cache for offline to work: `./`, `index.html`, `style.css`, `app.js`, `fuse.min.js`, `manifest.json`.
- **`OPTIONAL_ASSETS`** — Icons/images. A cache miss here does **not** break offline support.

## How to Bump the Cache Version

1. Open [`sw.js`](../../sw.js).
2. Change `CACHE_NAME` to a new version, e.g.:
   ```js
   const CACHE_NAME = 'whisky-db-v4';
   ```
3. On the next page load, the browser installs the new SW, re-fetches all `CORE_ASSETS`, and deletes old caches (handled in the `activate` event).

> **Rule:** Bump `CACHE_NAME` any time `index.html`, `style.css`, `app.js`, `fuse.min.js`, or `manifest.json` changes. If only `sw.js` itself changed, a bump is still required.

## Debugging Fetch / Cache / Offline Issues

### Step 1 — Check the browser DevTools

1. Open **Application → Service Workers** — confirm the SW is registered and active. If a new SW is "waiting", an old tab may be holding the scope open.
2. Open **Application → Cache Storage** — inspect the contents of `whisky-db-vX`. Check for stale or missing assets.
3. Open **Application → IndexedDB → whisky_db_search → cache** — verify the `whiskies` record exists and contains `data` (array) and `lastSync`.

### Step 2 — Check the Network tab

- Filter by `Fetch/XHR`. Look for the Firebase request: `https://<project>.firebaseio.com/trackers/whiskies/<code>.json`
- A `401`/`403` means wrong access code.
- A `net::ERR_FAILED` or `AbortError` usually means: offline, captive portal, or the 10-second fetch timeout (`FETCH_TIMEOUT_MS`) fired.

### Step 3 — Check `statusText` in the UI

The `#statusText` element always reflects the current state. Error messages from `fetchFreshData()` surface there verbatim.

### Step 4 — Console errors

Look for:
- `IndexedDB save failed` — storage quota may be full.
- `Service Worker registration failed` — the SW file has a syntax error or is being served with wrong MIME type.

## Adding a New Cached Asset

1. Add the file path to `CORE_ASSETS` (required) or `OPTIONAL_ASSETS` (optional) in `sw.js`.
2. Bump `CACHE_NAME`.
3. Deploy (see [css-build skill](../css-build/SKILL.md) for full deploy workflow).

## Adding a New App Shell File

If you add a new JS or CSS file that the app requires to function offline:

1. Add a `<script>` or `<link>` tag in `index.html`.
2. Add the file path to `CORE_ASSETS` in `sw.js`.
3. Bump `CACHE_NAME`.
4. Rebuild CSS if applicable, then commit and push.

## Important Constraints

- **Cross-origin requests (Firebase API) are never intercepted by the SW.** If the fetch fails, `fetchFreshData()` in `app.js` catches it and falls back to `loadCache()`.
- **Do not add runtime caching of Firebase responses in the SW.** The app manages its own data cache in IndexedDB.
- **The SW uses `skipWaiting()` on install** — new service workers activate immediately without waiting for old tabs to close.
