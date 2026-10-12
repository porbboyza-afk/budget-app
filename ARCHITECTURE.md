# จดเงิน: architecture and Android handoff

Updated 2026-10-12. This repository currently builds a web/PWA application, not an Android APK. The cleanup prepares reusable boundaries; it does not prove Android compatibility.

## Module responsibilities

| Layer             | Files                                                | Responsibility                                                                                                     |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Data rules        | `model.js`                                           | Validate/migrate schema, dates, integer satang, monthly/trip totals. No browser API.                               |
| Ledger operations | `ledger-domain.js`                                   | Queries, pagination, AI context/proposals and guarded save undo. Receives data explicitly; no DOM/network/storage. |
| Persistence       | `ledger-repository.js`                               | Owner keys, validated writes, legacy backup/recovery and preferences through an injected key/value adapter.        |
| Web orchestration | `app.js`                                             | Connect account/state, manual-entry UI, summaries, files and sync.                                                 |
| Web features      | `trips.js`, `ai-ui.js`, `views.js`                   | Trip UI, AI dialog/image handling and hash navigation.                                                             |
| Web presentation  | `ui-format.js`, `index.html`, `styles.css`           | Thai formatting, escaped markup and responsive layout.                                                             |
| Platform services | `auth.js`, `ai-client.js`, `cloud-sync.js`, `pwa.js` | Google web authentication, authorized requests, revision sync and web installation/offline shell.                  |
| Backend           | `server/*`, `functions/api/*`                        | Firebase identity/owner checks, server-only provider key, quotas, schema validation and D1 revision CAS.           |

Dependency direction: UI/platform code calls domain rules. Domain rules must not import UI, browser globals, Firebase or Cloudflare. The repository accepts a synchronous storage adapter; currently `app.js` passes `localStorage`. Trip preferences use the same repository and owner key.

## Data contract

- Version 2: `{version, openingCents, demo, entries, trips}`. Keep existing owner storage keys and schema version during structural refactors.
- Money is integer satang; never calculate amounts with floating point baht. IDs remain stable across edits and sync.
- `tripId: ''` means no trip; otherwise the referenced trip must exist. Travel dates do not restrict payment dates. Trip spending counts expenses only; monthly totals count the same original rows once.
- Version 1 imports migrate to version 2. Preserve legacy/recovery snapshots. Old clients cannot PUT version 1. Restore and undo are deliberate replacements with stale-state/owner guards.
- Local compare-before-write catches observed changes; **it is not an atomic transaction across tabs**. Cloud D1 uses revision CAS independently.

## Android work still required

Choose the delivery approach before creating a mobile project. A web-hosted Android shell and a native UI have different integration work. Do not assume that copying this folder produces a native app.

1. **Storage:** introduce asynchronous repository operations and transactional owner-scoped database writes for native storage. The synchronous injected adapter is a boundary, not a plug-in for an asynchronous database.
2. **Account:** replace web popup/global `window.budgetAuth` with a mobile account/token adapter. Test token expiry, logout, account switching and offline-owner access on the target device.
3. **API:** relative URLs and same-origin POST/PUT checks currently assume a web origin. Define native API base URL, allowed client request policy and token handling explicitly; keep server identity checks and provider secrets. Origin/CORS is not authorization.
4. **Files/images:** replace browser file inputs, canvas/image decoding and download links with mobile adapters. Preserve review-before-save and avoid storing receipt images unnecessarily.
5. **Lifecycle:** replace browser visibility/online timers and PWA service-worker assumptions with mobile lifecycle/connectivity handling. Review back-button behavior and interrupted writes.
6. **Verification:** run synthetic domain tests, then device login, offline/reconnect, trip CRUD, restore, cross-account isolation and sync conflicts. Current automated tests do not cover these device flows.

For a native implementation in another language, port the documented rules and fixtures; JavaScript modules do not automatically become native-language code.

## Maintenance

Run `npm ci`, `npm test`, `npm run format:check`, and `npm run build`. `npm run format` uses the pinned development formatter ([Prettier installation guidance](https://prettier.io/docs/install)). Build copies an explicit public allowlist; add new browser modules to both `scripts/assets.mjs` and `sw.js`. Tests, notes, env files and server implementation must never enter `dist`. CSS order is preserved; edit the relevant rules rather than appending another override layer.

Source rollback: `backup/jodngern-before-cleanup-20261012`. Data remains schema 2; a source rollback must keep a compatible backend and public module/cache set.
