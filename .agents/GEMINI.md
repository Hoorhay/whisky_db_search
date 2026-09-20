# Whisky DB Search — Project Rules

This is a **vanilla JS, offline-first PWA** that provides fuzzy search over a whisky database fetched from Firebase Realtime Database and cached locally.

## Architecture Overview

- **`index.html`** — Single-page app shell. All UI is server-rendered HTML; no build step for markup.
- **`app.js`** — All application logic: fetching, caching, search (Fuse.js), rendering.
- **`input.css`** — Tailwind CSS source. **Never edit `style.css` directly** — it is compiled output.
- **`style.css`** — Compiled Tailwind output. Rebuilt via `npx @tailwindcss/cli -i input.css -o style.css`.
- **`fuse.min.js`** — Vendored Fuse.js 7.0.0. Do **not** load libraries from a CDN.
- **`sw.js`** — Service worker: cache-first for app shell assets, network-bypass for Firebase API calls.

## Mandatory Coding Rules

1. **Vanilla JS only.** Do not introduce any JS framework, build tool, or npm package for runtime code. The only permitted library is the vendored `fuse.min.js`.
2. **XSS safety.** Every piece of user-derived or database-derived string rendered into `innerHTML` **must** pass through `escapeHtml()`. Never bypass this.
3. **Cache layer.** All data reads and writes must go through `idbGet`/`idbPut` (IndexedDB), with `localStorage` as the documented fallback. Do not add alternative storage paths.
4. **Credentials.** The Firebase base URL (`STORAGE_KEY_DB_URL`) and access code (`STORAGE_KEY_ACCESS_CODE`) are stored in `localStorage` only, and always retrieved via `getStoredCredentials()`.
5. **Tailwind classes only.** Style changes must use Tailwind utility classes in HTML/JS template literals. Do not write custom CSS unless there is no Tailwind equivalent — in that case, add it to `input.css` and rebuild.
6. **No inline `style=` attributes** unless absolutely unavoidable (e.g. dynamic values). Prefer Tailwind classes.
7. **Endpoint construction** is always done through `getEndpointUrl()`. Do not construct Firebase URLs ad-hoc elsewhere.

## Data Model

Each whisky record is a plain object. Required fields: `Name`. Common optional fields: `ABV`, `Year`, `Score`, `AvgScore`, `WBcode`, `Nose`/`Nosa`, `Taste`, `Finish`. All additional fields are surfaced in the detail modal automatically.

- `Score` takes precedence over `AvgScore` when both are present.
- ABV values may be decimals (0–1 range) or percentages; always normalise via `formatAbv()`.
- WB codes are newline-separated strings; always parse via `parseWbCodes()`.

## Search

Powered by **Fuse.js extended search** (`useExtendedSearch: true`). User input is split into whitespace-separated tokens; each token must match *all* fields ($and/$or). User input is escaped via `escapeExtendedSearchToken()` before being passed to Fuse.
