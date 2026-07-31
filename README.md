# ntn-ui

Local web UI for the [Notion Workers](https://developers.notion.com/workers/get-started/overview) (`ntn`) CLI. Point it at any worker project on disk and get a graphical view of syncs, runs, and capabilities without leaving your browser.

Status: **early scaffolding.** Nothing is stable yet.

## Prerequisites

- Node.js >= 22
- pnpm >= 11
- The `ntn` CLI installed and on your `PATH` (`ntn --version` should work from a terminal)
- At least one Notion Workers project on disk to point the UI at

## Run

```bash
pnpm install
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
