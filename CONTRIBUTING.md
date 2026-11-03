# Contributing to Speeedy

Thanks for your interest. This document covers everything you need to get started.

---

## Development Setup

**Prerequisites:** [Node.js](https://nodejs.org) 22.22+ and [pnpm](https://pnpm.io) (the exact version is pinned in `packageManager`; Corepack or `pnpm/action-setup` picks it up)

```bash
git clone https://github.com/sami-29/speeedy
cd speeedy
pnpm install
```

The repo is a pnpm workspace: `app`, `worker`, `packages/engine`, `packages/parsers`, `packages/contracts`, `extension`, `twa` and `voice-server`.

---

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Build every package that has a build step |
| `pnpm typecheck` | Type-check the root and every package |
| `pnpm lint` | Check for lint errors (Biome) |
| `pnpm lint:fix` | Auto-fix lint errors |
| `pnpm test:unit` | Run the workspace-shape test and each package's unit tests |
| `pnpm test:worker` | Run the Worker tests |
| `pnpm e2e` | Run the app's Playwright tests. They build and serve the site on port 4173; set `PW_PORT` to use another port (a busy port fails the run, it is never reused) |

---

## Code Style

- **TypeScript strict mode** — all code must pass `tsc --noEmit`
- **Biome** for linting and formatting — run `pnpm lint` before submitting
- **No `any` casts** unless the type is genuinely unknowable (e.g. non-standard browser APIs)
- **Comments should explain *why*, not *what*** — if the code is self-explanatory, skip the comment

## Pull Requests

1. Fork the repo and create a branch from `2.0`
2. Make your changes
3. Run `pnpm typecheck` and `pnpm build` — must pass with no TypeScript errors
4. Run `pnpm test:unit` and `pnpm test:worker` — all tests must pass
5. Run `pnpm lint` — no lint errors
6. Open a PR with a clear title and description

**PR title format:** `fix: short description` / `feat: short description` / `chore: short description`

Keep PRs focused. One feature or fix per PR is easier to review.

---

## Reporting Issues

Use [GitHub Issues](https://github.com/sami-29/speeedy/issues). Include:

- Browser and OS
- Steps to reproduce
- Expected vs actual behavior
- Console errors if any (open DevTools → Console)

---

## Versioning

This project follows [Semantic Versioning](https://semver.org):

- **MAJOR** — Breaking changes to the data format or public API
- **MINOR** — New features, backwards compatible
- **PATCH** — Bug fixes

When contributing a change that warrants a version bump, update [CHANGELOG.md](CHANGELOG.md) under an `[Unreleased]` section. The maintainer will assign the version number at release time.

## Releasing

1. Bump `package.json` and update `CHANGELOG.md`.
2. Commit to `main` with a message like `release: v1.3.0 - short description`.
3. GitHub Actions creates the `v1.3.0` tag and publishes the release using the matching changelog section.

To backfill a release that was committed but never published, run the **Release** workflow manually from the Actions tab and enter the version (e.g. `1.2.0`).
