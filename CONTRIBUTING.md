# Contributing to Speeedy

Thanks for your interest. This document covers everything you need to get started.

---

## Development Setup

**Prerequisites:** [Node.js](https://nodejs.org) 20+ and [pnpm](https://pnpm.io)

```bash
git clone https://github.com/sami-29/speeedy
cd speeedy
pnpm install
pnpm dev
```

The dev server starts at `http://localhost:5173`.

---

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server |
| `pnpm build` | Production build (runs `tsc` first) |
| `pnpm test` | Run unit tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm lint` | Check for lint errors |
| `pnpm lint:fix` | Auto-fix lint errors |

---

## Code Style

- **TypeScript strict mode** — all code must pass `tsc --noEmit`
- **Biome** for linting and formatting — run `pnpm lint` before submitting
- **No `any` casts** unless the type is genuinely unknowable (e.g. non-standard browser APIs)
- **Comments should explain *why*, not *what*** — if the code is self-explanatory, skip the comment

A pre-commit hook runs `lint-staged` automatically on staged `.ts` files.

---

## Architecture

Speeedy uses [Lit](https://lit.dev) web components with **light DOM** (no shadow DOM) so Tailwind classes apply directly.

```
src/
├── components/     Lit elements — pages, panels, overlays
├── config.ts       Site-wide constants (URL, GitHub link)
├── data/           Static data (benchmark passages)
├── models/         TypeScript interfaces (types.ts)
├── services/       Business logic — framework-agnostic
└── utils/          Pure helper functions
```

**Services are the core.** Components should be thin wrappers that call services and render state. The RSVP engine ([`src/services/rsvp-engine.ts`](src/services/rsvp-engine.ts)) is the most critical file — changes there need careful testing.

---

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `pnpm build` — must pass with no TypeScript errors
4. Run `pnpm test` — all tests must pass
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
