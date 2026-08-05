# NTN Worker Tools

Local web UI for the [Notion Workers](https://developers.notion.com/workers/get-started/overview) (`ntn`) CLI. Point it at any worker project on disk and get a graphical view of syncs, runs, and capabilities without leaving your browser.

Status: **Feature Complete.** Ready for external testing.

## Prerequisites

- Node.js >= 22
- pnpm >= 11 (repo pins `pnpm@11.18.0` via `packageManager`)
- The `ntn` CLI installed and on your `PATH` (`ntn --version` should work from a terminal)
- At least one Notion Workers project on disk to point the UI at

## First-time setup

### 1. Install Node.js

**Windows (winget, elevated PowerShell):**

```powershell
winget install OpenJS.NodeJS.LTS
```

If `winget` returns exit code `1603` with "A later version of Node.js is already installed", Node is already there — the installer just isn't on your current shell's `PATH`. Open a fresh PowerShell and check:

```powershell
node --version
```

If it still isn't found, add `C:\Program Files\nodejs` to your system `PATH` (elevated PowerShell):

```powershell
[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path","Machine") + ";C:\Program Files\nodejs", "Machine")
```

Then close and reopen PowerShell.

**macOS / Linux:** use your usual method (`brew install node`, nvm, fnm, distro package, etc.). Any Node >= 22 works.

### 2. Install pnpm

Node 25+ no longer bundles Corepack, so install pnpm directly with npm (which ships with Node):

```bash
npm install -g pnpm@11.18.0
```

Verify:

```bash
pnpm --version
```

Should print `11.18.0`.

> If you are on Node <= 24, you can alternatively use Corepack: `corepack enable; corepack prepare pnpm@11.18.0 --activate`. Corepack reads the pinned version from `packageManager` in `package.json` automatically.

### 3. Clone and install dependencies

```bash
git clone https://github.com/PrimaryGoals/ntn-worker-tools.git
cd ntn-worker-tools
pnpm install
```

## Run

```bash
pnpm dev
```

The web app runs at `http://localhost:5173`, the API server at `http://localhost:5174`.

## Layout

```
ntn-worker-tools/
├── apps/
│   ├── web/                Vite + React + TS + Tailwind
│   │   └── src/
│   │       ├── App.tsx             Top-level layout and routing between panels
│   │       ├── api.ts               Typed client for the server's /api/* endpoints
│   │       ├── format.ts            Pure formatters (bytes, durations, sync status, etc.)
│   │       ├── hooks/                One hook per concern: UI state, worker data (queries),
│   │       │                         deploy/sync mutations, webhook mutations, config mutations
│   │       └── components/
│   │           ├── ui/              Presentational primitives (Panel, MenuItem, ExitCodeBadge, ...)
│   │           ├── modals/          TokenPushModal, FolderPickerModal, GitCheckinModal, ...
│   │           └── *.tsx            Feature components (MenuBar, WorkersList, RunsList, ...)
│   └── server/              Fastify server that shells out to ntn CLI
└── packages/
    └── shared/               Types shared between web and server
```

Start in `App.tsx` to see how a screen is assembled, then follow the hook/component names — each hook or component file is scoped to one concern, so the file name tells you what you'll find inside.

## Roadmap

MVP:

- [X] Sync status (live), preview, trigger, state reset
- [X] Runs list + logs viewer
- [X] Capabilities list + enable/disable

Later:

- [ ] Fetch code from deployed agents that Notion wrote


## License

Apache 2.0 with trademark clause. See [LICENSE](LICENSE) for details. Allows commercial use and derivatives with attribution required; Primary Goals branding is protected.
