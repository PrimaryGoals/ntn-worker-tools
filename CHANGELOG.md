# Changelog

All notable changes to this project are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.9.0] - 2026-08-17

### Added
- "Deploy updated workers" flow made interactive: pushing multiple workers' code and env/secrets to Notion now walks through a guided, per-worker selection instead of a single blind bulk action; bulk selection extended to cover code deploys as well as secrets
- Usage view: click a column header to sort by it (descending first, ascending on a second click); new "C/E" column showing credits per execution

### Changed
- Menu/branding links now go to a dedicated redirect page on primarygoals.com/ntn
- Usage view no longer requires a worker to be selected to display — it only depends on the "Usage" mode being active

## [0.8.0] - 2026-08-12

### Added
- Out-of-date worker indicator: workers with local code newer than their last deploy are flagged, detected via a folder mtime scan (not git log, so it works for non-git workers too)
- "Deploy workers" submenu with "deploy updated workers" — deploys every out-of-date worker in one action, auto-selecting `ntn workers deploy` or `pnpm run deploy` per worker, with a confirmation listing exactly which workers will be deployed
- "Sync Options" submenu grouping sync pause/resume/reset
- Worker rename, including updating the local folder, `package.json` name/deploy script, and re-fetching the worker from Notion afterward
- Time marker: mark a point in time and split the runs panel into before/after
- Clearer error message when registering a local folder that belongs to a different worker — shows the folder's actual worker name
- `watch-debug.mjs` diagnostic script for investigating phantom `dev:server` restarts
- `shutdown-stray-servers.ps1` for killing stray dev servers left behind by testing

### Changed
- Header layout: worker menu moved to the far left (so submenus have room to open), branding moved to the far right; workspace name now links to primarygoals.com
- `apps/server/src/index.ts` split from one ~980-line file into `state.ts` plus one route module per domain (`routes/session.ts`, `config.ts`, `fs.ts`, `workers.ts`, `sync.ts`, `worker-local.ts`, `webhook.ts`, `runs.ts`), deduplicating the sync trigger/pause/resume/reset handlers along the way
- Webhook fire now shells out to `curl` instead of Node's `fetch()`
- Config writes are now atomic with a backup taken before each write
- Folder picker excludes hidden directories

### Fixed
- `pnpm run deploy` / `ntn workers deploy` selection for `deploy-updated` matching workers by `workerId` correctly (previously matched nothing, so it always reported "No out-of-date workers found")
- Webhook run-completion poll matched against a `runId` snapshot instead of the client clock, avoiding clock-skew misses
- `dev:server`'s `node --watch` scoped to `apps/server/src` and eventually dropped from the top-level script after the narrower scoping didn't fully eliminate phantom restarts (root cause still under investigation — see #5)

## [0.5.2] - 2026-08-05

### Added
- Sync management: status display, trigger, pause, resume, and state reset for sync-type workers
- Worker capabilities display, distinguishing webhook vs. sync workers
- Sync status automatically re-checked and appended after sync pause/resume/reset
- Run logs automatically fetched and appended after firing a webhook, once the triggered run completes
- `apps/server/.env` support (copy `apps/server/.env.example`) for `PORT`/`HOST`/`LOG_LEVEL`/`WEB_URL`
- Local timestamp on the server's startup/restart log line
- `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md` in preparation for making the repository public

### Changed
- Worker output panel now interleaves each `ntn` command with its own output (command → output → separator) instead of grouping all commands above all output
- `apps/web/src/App.tsx` refactored from a single 2204-line file into hooks (`hooks/`) and components (`components/`), organized by concern rather than arbitrary size — see the Layout section in [README.md](README.md)
- Vite now fails immediately instead of silently moving to a different port when 5173 is already in use

### Fixed
- `pnpm run deploy` failing on Windows — pnpm's `.CMD` shim wasn't resolvable by `execFile` without a shell
- Webhook fire failing with a Cloudflare 403 — Node's default `fetch()` User-Agent was being blocked
- Clear, actionable message ("Confirm that your local server is running...") instead of a raw "Failed to fetch" when the local server isn't reachable
- Clear, actionable message when the server's port is already in use, instead of `node --watch`'s generic "Failed running..." text — including when a second `pnpm dev` instance fails before it would normally get the chance to report it
- `.gitignore` UTF-16 encoding corruption from a PowerShell redirect

## [0.5.1] - 2026-08-04

### Fixed
- `package.json` version and license field corrected (was still `0.0.1` / `MIT`)

### Changed
- Merged `dev` into `main` to establish a shared history between the two branches going forward

## [0.5.0] - 2026-08-01

Initial test release.

### Added
- Worker list, run history, and log viewer
- Worker detail panel: get, usage, webhooks, env pull
- Webhook firing with `X-Webhook-Secret` support
- Local folder registration, deploy (`ntn workers deploy` / `pnpm run deploy`), env push
- Local git check-in modal
- Session-token authentication for the local server
- Apache 2.0 license with a trademark clause protecting Primary Goals branding
- Branding: PrimaryGoals.com splash, Notion Consulting Partner / Certified Admin badges

[Unreleased]: https://github.com/PrimaryGoals/ntn-worker-tools/compare/v0.5.2...HEAD
[0.5.2]: https://github.com/PrimaryGoals/ntn-worker-tools/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/PrimaryGoals/ntn-worker-tools/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/PrimaryGoals/ntn-worker-tools/releases/tag/v0.5.0
