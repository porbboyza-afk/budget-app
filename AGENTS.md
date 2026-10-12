# Repository Guidelines

## Structure and Boundaries

This is **จดเงิน**, the income/expense PWA in `porbboyza-afk/budget-app`. Read `ARCHITECTURE.md` and the latest section of `RELEASE_HANDOFF.md` before changing data or platform integration.

`model.js` validates schema and money; `ledger-domain.js` contains platform-independent operations. Keep both free of DOM, storage, auth and network calls. `ledger-repository.js` accepts storage adapters. `app.js` coordinates web features; `trips.js` and `ai-ui.js` own their UI. `server/` holds backend logic, `functions/api/` exposes it, and `tests/` contains synthetic Node tests. `legacy/` is archived source.

## Development Commands

- `npm ci`: install locked development tools.
- `npm run dev`: start the loopback-only web/API server on port 8771.
- `npm test`: run synthetic domain/repository tests; never use real account data as fixtures.
- `npm run format`: format maintained source; `npm run format:check` checks consistency.
- `npm run build`: produce the public allowlisted `dist/` output.

The formatter is a development dependency. Build and browser runtime do not depend on it. Never publish the repository root; deploy `dist/` with Pages Functions.

## Coding and Data Rules

Use ES modules, two-space indentation and the committed Prettier configuration. Prefer named functions and explicit inputs over browser globals in reusable code. Use integer satang and the shared validator; preserve IDs, owner keys, schema migration and revision checks. Add browser modules to both the asset allowlist and service-worker shell. Preserve CSS cascade order during cleanup.

## Review and Android Preparation

For verification tasks, run the synthetic tests and build. Report source review, automated checks and actual device verification separately. Android is not implemented: native auth, async transactional storage, file/image APIs, API origin policy and lifecycle still require adapters. Do not call a synchronous `localStorage` wrapper native-ready.

Commits use short imperative subjects, such as `Add trip budgets`. Keep behavior changes distinct from formatting where practical. Reviews should explain purpose, affected boundaries, checks and remaining limitations. Protect credentials; exclude `.env*`, real exports and account identifiers from Git. Back up and verify targets before destructive operations. Never reset user browser profiles or extensions.
