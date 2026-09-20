---
name: css-build
description: >-
  Use this skill when the user asks to rebuild or compile the CSS, update styles
  using Tailwind, or deploy/publish changes to the whisky_db_search project.
  Covers the full workflow: edit input.css, compile with Tailwind CLI, verify
  output, commit with git, and push to the remote (GitHub Pages / static host).
---

# CSS Build & Deploy Workflow

This project uses **Tailwind CSS v4** compiled via the standalone CLI. The source is `input.css`; the output is `style.css`. Never edit `style.css` directly.

## 1. Edit Styles

Make all style changes in [`input.css`](../../input.css) using Tailwind directives or custom CSS.  
For UI changes embedded in JS template literals (e.g. in `app.js`), use Tailwind utility classes directly in the HTML strings.

## 2. Rebuild CSS

Run from the project root (`/home/jhura/Projects/whisky_db_search`):

```bash
npx @tailwindcss/cli -i input.css -o style.css
```

> **Verify:** Check that `style.css` was updated (file modification time changes, or inspect a class you added/changed is present in the output).

## 3. Bump the Service Worker Cache (if app shell files changed)

If any of the files in `CORE_ASSETS` in [`sw.js`](../../sw.js) changed (`index.html`, `style.css`, `app.js`, `fuse.min.js`, `manifest.json`), bump `CACHE_NAME`:

- Change the version suffix, e.g. `whisky-db-v3` → `whisky-db-v4`.
- This forces all clients to install the new service worker and re-cache fresh assets.

See the [pwa-cache skill](../pwa-cache/SKILL.md) for detailed guidance.

## 4. Commit Changes

```bash
git add -A
git status          # review what's staged
git commit -m "describe your change here"
```

## 5. Push & Deploy

```bash
git push
```

If the remote is GitHub Pages (served from `main` or a `gh-pages` branch), the site updates automatically after the push. Verify by opening the live URL a few seconds later.

## Checklist

- [ ] Only `input.css` was edited (not `style.css` directly)
- [ ] `npx @tailwindcss/cli -i input.css -o style.css` ran without errors
- [ ] `style.css` reflects the changes
- [ ] `CACHE_NAME` bumped in `sw.js` if any cached file changed
- [ ] `git commit` and `git push` completed successfully
