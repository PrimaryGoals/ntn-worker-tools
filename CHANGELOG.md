# Changelog

All notable changes to this project are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
