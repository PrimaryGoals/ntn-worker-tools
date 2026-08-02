# ntn-ui

Local web UI for the [Notion Workers](https://developers.notion.com/workers/get-started/overview) (`ntn`) CLI. Point it at any worker project on disk and get a graphical view of syncs, runs, and capabilities without leaving your browser.

Status: **early scaffolding.** Nothing is stable yet.

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
ntn-ui/
├── apps/
│   ├── web/       Vite + React + TS + Tailwind + shadcn/ui
│   └── server/    Fastify server that shells out to ntn
└── packages/
    └── shared/    Types shared between web and server
```

## Roadmap

MVP:

- [ ] Sync status (live), preview, trigger, state reset
- [ ] Runs list + logs viewer
- [ ] Capabilities list + enable/disable

Later:

- [ ] Deploy + env push
- [ ] Global `ntn-ui` CLI wrapper

## License

MIT. See [LICENSE](LICENSE).
