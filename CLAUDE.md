# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Flexlist is a private French-language PWA hosted on a NAS: browse/swipe movies and series not yet in the `NETFLEX` library, mark them as favorites, and have Radarr (movies) / Sonarr (series) download them. `README.md` covers install/usage for the end user; `RAPPORT.md` is the delivery report (design decisions, known limits, roadmap). UI strings, log messages and comments are in French — keep that convention.

## Commands

All code lives in `app/`. There is **no build step, no dependencies (no `node_modules`), no linter and no test suite** — plain Node ≥ 20 ES modules on the server and plain ES modules in the browser.

```powershell
cd app
$env:LIBRARY_PATH='\\NAS-Yul\Home\NETFLEX'; node server/index.js   # http://localhost:8787
```

Env vars: `PORT`, `DATA_DIR` (default `../data`, i.e. the repo's `data/`), `LIBRARY_PATH`, `RADARR_URL`, `RADARR_API_KEY`, `SONARR_URL`, `SONARR_API_KEY`, `APP_PASSWORD`. For local runs prefer a scratch `DATA_DIR` so the real `data/*.json` (pre-filled catalog + library identification) isn't overwritten.

Deployment: `docker-compose.yml` is pasted into Portainer as a stack. It runs the stock `node:24-alpine` image with `app/` mounted read-only at `/app`, `data/` at `/data`, and the library read-only at `/netflex`. **Updating the app = replacing files in `app/` and restarting the container.** Changing `public/` assets: bump the cache names in `public/sw.js` only if the shell list changes (shell is network-first, so normal edits propagate); add any new JS/CSS file to the `SHELL` array there.

## Architecture

**Server (`app/server/`)** — one `http` server in `index.js` with a tiny hand-rolled router (`route(method, '/api/x/:param', handler, {open})`; handlers return JSON, throw `Object.assign(new Error(..), {status})`). Static files from `public/`. Optional password auth via an HMAC cookie (`flx`). `index.js` also owns settings, the scheduled `tasks` table and the view-model builders (`card`, `swipeCard`, `discover`, `swipeDeck`, `itemDetail`, `libraryList`).

Four stateful services, each persisted with `JsonFile` (`store.js`: atomic write via tmp+rename, debounced `save()`, corrupt files are renamed aside) into `DATA_DIR`:

- `Catalog` (`catalog.js`) → `catalog.json`: movie metadata from Radarr's public metadata API (TMDb/IMDb, French titles) and series from TVmaze (+ TVDB id resolution for Sonarr). Named `lists` (`movies_trending`, `series_popular`, …) are refreshed by tasks; items are normalized by `normalizeMovie` / `normalizeShow`.
- `Library` (`library.js`) → `library.json` + `identify.json`: read-only scan of the NETFLEX folders (folder-name parsing), then "identify" matches each folder to TMDb/TVmaze ids (using Radarr/Sonarr listings + catalog search) for posters/genres. `library.match(item)` is the single "already on the NAS?" test used everywhere (ids first, then accent/article-insensitive titles ±1 year). It also derives genre affinity and recommendation seeds for "Pour vous".
- `Favorites` (`favorites.js`) → `favorites.json`: favorites with prefs, status state machine (`pending → searching/notfound/upcoming → downloading → downloaded → available`, plus `partial`/`error`), event log, and the `dismissed` map used by Swipe/Discover. `syncAll()` (every 10 min) pushes pending items, polls the arr queues, re-triggers searches for `notfound` items (interval from settings, capped per cycle) and flips to `available` when `library.match` succeeds.
- `ArrClient` (`arr.js`): thin Radarr/Sonarr v3+ client. Translates the user's language/quality prefs (`LANGS`, `QUALITIES`) into profiles named `Flexlist · <langue> · <qualité>` plus custom formats, created on demand; added items get the `flexlist` tag. It picks a valid root folder itself (Sonarr has a bogus `NETFLEX Drive` root that must be avoided).

Items are identified everywhere by a string `key`: `movie:<tmdbId>` or `series:<tvmazeId>`.

**Scheduling**: `tasks` in `index.js` (`scan`, `identify`, `movies`, `trending`, `crawl`, `sync`) run via a 60 s `setInterval` checking `due(name)` against `tasks.json`; `startup()` runs them in a specific order so the app is useful ASAP. Tasks can also be triggered with `POST /api/tasks/:name`. Task bodies must never throw past `runTask`.

**Hard rule**: the app never deletes anything — library is mounted `:ro`, and removing a favorite only *unmonitors* it in Radarr/Sonarr. Don't add code that deletes media or arr items, and don't modify pre-existing arr profiles.

**Client (`app/public/`)** — no framework/bundler. `js/app.js` is the shell: hash router over `TABS` (each view module in `js/views/` exports its own render/mount), `api()` fetch wrapper (adds `X-Flexlist-User`, shows the login screen on 401), `addFavorite()` (opens the prefs sheet from `ui.js`, then `POST /api/favorites`), and a tiny event `bus` (`emit('favorites-changed')`) so views refresh each other. Per-device state (user first name) lives in `localStorage`. `sw.js` provides the offline shell (network-first) and a cache for TMDb/TVmaze posters; `/api/` is never cached. Icons/manifest make it installable (full install requires HTTPS).
