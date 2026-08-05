# Contributing to NTN Worker Tools

Thanks for your interest in contributing! This project is designed to make working with Notion Workers easier, and we welcome contributions that move us toward that goal.

## What we accept

- **Bug reports** — if something doesn't work, open an issue or a PR
- **Documentation** — improve the README, add examples, clarify setup
- **Features** — new worker-related capabilities (syncs, deploys, env management, etc.)
- **Fixes** — spelling, broken links, code improvements

## Scope

NTN Worker Tools is focused on **worker-related workflows**. We don't support pages, files, API datasources, or other non-worker Notion surfaces. If your contribution is outside this scope, we'll kindly suggest a different direction.  Although workers sometimes need to interact with other objects, this tool is focused on workers. If you believe the tool should expand the surface it acts upon, please begin with a conversation.

## Before you contribute

**For bug fixes and documentation:** Just open a PR. No need to ask first.

**For new features or significant changes:** Open a GitHub Issue first. We want to make sure the feature aligns with the tool's purpose before you invest time.

## Pull Request process

1. **Fork the repo and branch off `dev`** — this is where active development lives
   ```bash
   git clone https://github.com/YOUR-USERNAME/ntn-worker-tools.git
   cd ntn-worker-tools
   git checkout dev
   git checkout -b fix/your-fix-name  # or feature/your-feature-name
   ```

2. Make your changes

3. **Test manually** — since this is a local tool, describe how you validated your change works
   - What is required to execute your test?
   - What did you test?
   - On which worker type (webhook, sync)?
   - Any edge cases you checked?

4. **Push and open a PR against `dev`** — not `main`
   - `main` is for releases only; all development happens on `dev`
   - Include a clear title and description of what you changed and why

5. **Code review** — we'll check for functionality, code quality, and alignment with the project

6. **Merge** — once approved, your PR merges into `dev`. The maintainer will eventually merge `dev` into `main` for a release

## Development

See [README.md](README.md) for local setup (`pnpm install`, `pnpm dev`).

## Code quality

We value **pragmatism over perfection**. We readily admit that 95% of the codebase was written by AI to address human design specs.
The goal is a working, maintainable tool, not a flawless codebase. We do care about:
- **Functionality** — does it actually work?
- **Maintainability** — will future changes be easy?
- **Dependencies** — we're cautious about adding packages; if your PR adds a new dep, be prepared to justify it

## Questions?

Open an issue or start a discussion. We're here to help, and no question is too basic.
