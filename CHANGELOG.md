# Changelog

All notable changes to this project are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.5.0] - 2026-09-12

Working across more than one Notion workspace, where the same code is deployed to several and a git branch decides which one is current (#53, #57, #59, #61).

### Added
- Local folders are found by scanning rather than registered one at a time. "Scan folder for workers…" works with no worker selected: it picks a single root, and every worker folder beneath it is found by its `workers.json` or by a `package.json` that depends on the SDK alongside a `new Worker(` in its source. A folder outside that root stays scanned if a worker is already paired to it, so moving the root never drops a deployed worker (#53, #57)
- Folders with no worker in the connected workspace now appear at all. A list built from `ntn workers list` could only ever show what a workspace already had, which hid exactly the work to do when connecting to a workspace most of the code has never reached. Each says why it is there — first deployment, not on server, or workers.json unreadable — and carries Deploy, which opens the deploy flow already pointed at that folder (#53)
- "Map Repo+Branch:Workspace…" in the Worker menu: a grid of every known workspace against every repository, for choosing which branches deploy to which workspace. Columns cover the scanned repositories plus any with saved links still on disk; rows and columns are alphabetical and scroll as they grow. Each column fetches its branches on open, listing local and origin branches as one entry per name, and falls back to what git already knows with a warning when the fetch fails. A cell holds several branches, but a branch belongs to one workspace per repository; linked branches that no longer exist stay visible as missing. The dialog closes only through Save or Cancel, and Save replaces each repository's links in a single request (#57)
- The branch map decides what the worker list offers. A repository counts as part of a workspace only when one of its branches is mapped to it. Checked out on a mapped branch, its folders are listed; checked out on another branch while one is mapped to the connected workspace, "Workspace and branch do not match." sits above the list with the connected workspace, the repo and branch, and that branch's workspace on separate lines, names both remedies as commands (`ntn login`, or `git switch` to the mapped branch), and ends with a red reminder to refresh the tab. A repository with no branch mapped to the connected workspace is not a mismatch: its undeployed folders are left out, summed up in one line with a Map… button. Workers already deployed are always listed (#59)
- "Add workspace by ID" in the branch map, for mapping branches to a workspace before anything is deployed there. The name is looked up through `ntn whoami` without switching the login, so it works for any workspace this login has a token for
- First-run setup. With no folder to scan, the folder picker opens once `ntn whoami` answers; once a chosen folder's scan finds repositories with workers, the branch map opens to finish setup. The picker can be closed and returns on the next load until a folder is chosen; the map opens by itself only once
- A status strip in the header: connected workspace, the folder being scanned, and the repository and branch of the selected worker. The repository is named by its origin rather than its local path — a worker can live in a repo of its own, where "main" alone says almost nothing — and links to it (#53)
- Folders the scan finds that are not workers to act on can be ignored from their row, and are listed with a way back (#53)
- The config file carries a layout version (`configVersion`) and the app version that last saved it (`writtenBy`). Conversions run as numbered steps from the file's version up to the server's, instead of each guessing from what the file contains. Before converting, the original is kept as `config.v<version>.json`, which later saves never overwrite. A file saved by a newer version is read but never saved over: changes are refused with a message naming both versions, so running an older release against it cannot silently drop what the newer one recorded. Deploys and pushes still run in that state; only their records are skipped
- API routes behind the map: `GET /api/repos`, `GET /api/repos/branches`, `PUT /api/config/branch-workspaces` and `POST /api/config/workspace-names` (#57)

### Changed
- "Needs redeploy" compares content, not file times. A `git checkout` rewrites every file that differs between branches, so a branch switch used to make nearly every worker claim it needed redeploying, while a change in a shared package — which touches no file inside any worker — went unnoticed. Each deploy now records a hash of the worker's source plus every workspace package it depends on, transitively, along with the branch and commit it shipped from. Records written before this keep the old comparison until their next deploy (#53)
- Refreshing the workers list also confirms the connected workspace and rescans, so an `ntn login` in a terminal is reflected without reloading the page. Changing workspace clears the selected worker, which belonged to the workspace it was chosen in. Saving the branch map runs the same refresh (#53, #59)
- The Worker menu opens with "Scan folder for workers…" and "Map Repo+Branch:Workspace…" at the top level, replacing the "Local folder" submenu and its "Set local folder…". "Reveal in Explorer" left the dropdown and remains in the right-click menu, where it acts on the row you clicked (#57)
- `workerLocalPaths` is retired. A path recorded once at registration and never revisited had accumulated folders that had moved, one that no longer existed, and a single worker under three ids across two workspaces. "Forget local folder" went with it: there is nothing stored to forget. Fields retired by earlier versions (`workerLocalPaths`, `workerIsGitRepo`, `workerGitRoot`, `timeMarkers`) are removed from the config once a scan root exists (#53)
- Records for deleted workers are forgotten. Deploy and push history is kept per worker ID, so a worker deleted on the server left its records in the config for good. At startup the server now lists every known workspace and drops records whose worker appears in none of them; if any workspace cannot be listed, or a listing answers for a different workspace, nothing is dropped

### Fixed
- "Set local folder…" did nothing at all unless a worker was already selected — the modal was gated on a selection the action itself never required (#53)
- Deploying to the wrong worker is now prevented rather than merely unlikely. `workers.json` is re-read immediately before every deploy, pnpm deploy, env push and batch action, and again before the confirmation dialog, since a branch switch rewrites that file underneath a folder and `ntn` reads it to decide which worker it is updating. The message names the workers and workspaces involved instead of printing three UUIDs (#53)
- Pushing secrets checks which workspace the `.env` token belongs to first. `.env` is gitignored, so it belongs to a clone rather than a branch: a branch switch leaves the previous workspace's token in place, which is how a worker in one workspace comes to be handed a credential for another. A mismatch stops the push; an unanswerable check does not (#53)
- Deploying a worker that was listed as "not on server" left the row saying so until the page was reloaded, because nothing invalidated the scan the row was built from (#53)
- The branch map and banners could name fewer workspaces than the app knew. The scan and `ntn whoami` save workspace names on the server as they answer, and the browser never re-read the config afterwards
- A workspace name looked up by ID is only recorded when `ntn whoami` answers for that same workspace, so a name can never be stored under the wrong ID
- The app icon has a transparent background, and the workers refresh button re-checks for undeployed changes

### Removed
- "Deploy to new workspace" in the Worker menu. Undeployed folders in the worker list carry their own Deploy button, which opens the same dialog already pointed at that folder, and the branch map decides which folders a workspace is offered (#61)

## [1.2.0] - 2026-09-04

### Added
- Right-click context menu on any worker in the sidebar. It and the header's Worker dropdown render from one definition in `workerMenu.ts`, so a label, a gate, or a disabled reason exists in exactly one place; the surfaces differ only in how they present it — the dropdown turns groups into submenus and greys unavailable items with their reason as a tooltip, while the context menu leaves those items out and collapses the single-item groups into one unheaded block at the bottom (#49)
- "Fire Webhook" in both menus, firing the same POST as the webhook URL in the details pane. Greyed with its reason for a worker that has no webhook, and absent from the context menu (#50)
- "Trigger Sync" under Sync Options, directly above "Update polling interval…" (#50)
- "paused" marker beside a worker's polling interval in the workers list, from a new `/api/workers/sync-paused` route. Whether a sync is disabled is server state rather than something the worker's source can answer, so the route fans out one `ntn workers sync status` per worker — held to the workers whose source declares a sync, which are the only ones showing an interval badge for the marker to sit beside (#50)

### Changed
- The worker menus recognize that one worker can have both a sync and a webhook: the sync and webhook actions are gated independently instead of treating the two as alternatives (#50)
- "sync pause" and "sync resume" are gated on the sync's current state — pause is unavailable on an already-paused sync, resume on a running one. Per the menus' existing convention that means greyed with the reason in the dropdown and absent from the context menu; when no status has been gathered for the worker yet, neither is gated (#50)
- The status check that already ran ~5s after sync pause/resume/reset now also updates the workers list's "paused" marker from the response it just received, rather than leaving the marker stale until the next full sweep (#50)

### Fixed
- OAuth "start (authorize)" appeared to do nothing from the web UI while the same command worked in a terminal: `ntn workers oauth start` only opens a browser when its stdout is a TTY, and the server always spawns it non-interactively, so the CLI printed the authorization URL and exited without opening anything. The route now pulls that URL out of stdout and opens it itself — `rundll32 url.dll,FileProtocolHandler` on Windows, `open`/`xdg-open` elsewhere — and leaves the URL in the output panel so it can still be copied by hand (#48, #49)
- `apps/web/tsconfig.tsbuildinfo` was tracked and unignored, so `tsc -b` left the working tree dirty after every build. Untracked, and `*.tsbuildinfo` added to `.gitignore` (#50)

## [1.1.0] - 2026-09-02

### Added
- Agents tab alongside Workers, with agent list, session list, per-agent usage, and an agent menu bar — bringing agent views to parity with the worker views (#43)
- Agent credit-limit and status modals, backed by a new `agents` route module (#43)
- Colored health-check indicators for every worker, keyed to how recently it last failed (#41)
- The connected workspace name, from the `whoami` call, shown in the header (#41)
- "Update polling interval…" dialog under Worker → Sync Options: lists every `worker.sync()` found in the registered local folder and edits its `schedule:` in place. A sync's interval exists only in the worker's source — `ntn workers capabilities` reports just `{_tag, key}` — so this reads and rewrites the project's TypeScript (#45)
- Polling-interval editing resolves `schedule: SCHEDULE` to a module-level constant and rewrites that declaration, preserving the author's indirection; imported constants stay read-only, and a sync with no `schedule:` shows its effective `30m` default and has the property inserted on save (#45)
- Credit cost estimates per interval, from `usage.credits / usage.sandboxCount`, showing what the deployed schedule costs and what an edited one would (#45)
- Sync workers show their polling interval beside the name in the workers list (#45)
- Deploy confirmation dialog, replacing the plain `window.confirm` on both Deploy menu items (#45)

### Changed
- Deploying a sync worker now passes `ntn workers deploy --yes`. A sync worker owns a managed database, so `ntn` stops to confirm before deploying it, and that prompt cannot be answered from a non-interactively spawned CLI — without the flag such a deploy can only fail. As a result, a schema migration pending on a sync worker now proceeds without a review step when deploying from this app (#45)
- pnpm bumped to 11.25.0; Corepack dropped from the setup docs (#44)

### Fixed
- The "redeploy" badge stayed lit after a successful deploy until a manual refresh — the deploy mutations invalidated only the workers query, not the config timestamp and local mtimes the badge is derived from. They now also refresh sync status, so a deployed schedule change is reflected immediately (#45)
- The "push secrets" badge had the same defect in a worse form: pushing secrets invalidated nothing at all (#45)

### Security
- Bumped `fastify` 5.11.0 → 5.12.1 and `fast-uri` 4.1.2 → 4.1.3, clearing 5 Dependabot alerts: 4 high (`fast-uri` SSRF and host confusion in URI parsing) and 1 moderate (`fastify` `X-Forwarded-*` spoofing under `trustProxy`) (#46)

## [1.0.0] - 2026-08-25

### Added
- Worker search/filter box in the Workers panel header (shown once there are more than 10 workers), case-insensitive match on worker name with a one-click clear (#35)
- "Help" menu item linking to the Primary Goals support page

### Changed
- Consolidated the Primary Goals redirect URL into a single `PRIMARY_GOALS_URL` constant, used by the Help menu item, the header link, and the branding splash
- README overhaul: added a demo video, and "User Interface" and "Menu Options" sections illustrated with screenshots

### Fixed
- Cross-worker "All workers since" runs view no longer requires a worker to be selected first (#37)

### Removed
- "Local check-in" menu feature (git status/commit UI) and the git-detection plumbing that existed only to support it

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

[Unreleased]: https://github.com/PrimaryGoals/ntn-worker-tools/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/PrimaryGoals/ntn-worker-tools/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/PrimaryGoals/ntn-worker-tools/compare/v0.9.0...v1.0.0
[0.9.0]: https://github.com/PrimaryGoals/ntn-worker-tools/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/PrimaryGoals/ntn-worker-tools/compare/v0.5.2...v0.8.0
[0.5.2]: https://github.com/PrimaryGoals/ntn-worker-tools/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/PrimaryGoals/ntn-worker-tools/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/PrimaryGoals/ntn-worker-tools/releases/tag/v0.5.0
