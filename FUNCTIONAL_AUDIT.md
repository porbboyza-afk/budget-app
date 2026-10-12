# จดเงิน: functional audit — 2026-10-12

Scope: maintained web/PWA source at the user's request before everyday use. Three independent reviewers examined ledger/UI, cloud/PWA and AI/auth/backend. Changes preserve schema 2 and owner keys. Source backup: `backup/jodngern-before-functional-audit-20261012`.

## Bugs fixed

- Monthly summary could retain another account's category names/totals after an account change. Rendering now closes and clears stale summaries; account changes also clear filters.
- An open tab could resurrect a ledger removed by another tab. Removal now blocks stale writes, clears pending AI/undo and pauses sync. Explicit cloud/file recovery is still available.
- Reloading after the ledger key was erased but sync metadata remained could upload an empty replacement. Missing local data now pauses sync before any asynchronous request and requires an explicit choice.
- Repair preserved malformed JSON but could overwrite invalid version 2 data without an automatic snapshot. Validation now determines whether to preserve `:before-repair`.
- AI batch undo was disabled because object property order differed after validation. Undo compares the seven entry values and still refuses changed records.
- Token refresh could leave AI or cloud requests waiting indefinitely. Whole-request deadlines include token acquisition and response parsing; late tokens cannot initiate requests.
- Delayed sync responses could claim success after a pause. Pause/account checks protect acknowledgements, including explicit conflict resolution.
- Identical data in two tabs could produce a false sync conflict. Canonically identical data acknowledges the remote revision; different data with a backward revision requires an explicit choice. Malformed sync metadata is ignored.
- Cloud recovery could fail on erased/damaged local data. It now backs up available raw data, avoids inventing an empty backup and clears the fault only after a validated local write.
- Rejected minute-limit AI requests consumed daily/global quotas. Reservation now rolls back all buckets using the existing positive-count CHECK and D1 batch transaction. No schema migration. [D1 batch semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
- Ledger PUT with JSON null/array/primitives returned a server error. Invalid payload shapes now return 400 before any write.

## Evidence

| Area                | Check and result                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automated rules/API | `npm test`: 56 TAP tests passed (includes three enclosing tests), synthetic storage, Firebase responses and D1 adapters only. Covers satang, schema/migration, trip totals, paging, undo, quota rollback, ownership, CAS, recovery, timeouts and request rejection.                                                                                              |
| UI flows            | `python tests/browser_audit.py`: 11 groups passed in fresh headless Brave at 393 × 852. Actual built UI, mocked auth/API. CRUD/undo/refresh, filters/months, trips/budgets/archive, JSON/CSV, AI review/duplicates/batch undo, receipt image processing, account transitions, navigation/install help and offline owner fallback.                                |
| PWA                 | `python tests/pwa_browser_audit.py`: 3 groups passed with the actual built service worker. Public-only shell, offline reload/manual save, waiting update/explicit activation/reload with ledger preserved. Loopback site and mocked API.                                                                                                                         |
| Quota SQL           | Exact schema/SQL exercised against in-memory SQLite: each exhausted bucket rolls back the reservation and repeated rejection preserves counts. Concurrent admission tested with a transactional mock. A read-only SQL assertion against production table metadata confirmed CHECK(used > 0), with zero rows written; no ledger/quota row contents were selected. |
| Packaging           | Public asset build, formatter and whitespace checks pass. Test scripts, docs, env and server implementation are excluded from `dist/`.                                                                                                                                                                                                                           |

Browser scripts require Python Playwright and installed Brave; they bind loopback only and never open the user's profile. Run `npm run build` first. All datasets and identities are synthetic. No real ledger writes, paid AI calls, browser-profile resets or database migrations were performed by this audit.

## Practical limits

This audit does not prove every physical-device or external-provider condition. Real Google popup/network behavior, current paid AI accuracy and physical Samsung/Android installation were not retested here. Native Android remains separate work described in `ARCHITECTURE.md`.

Local compare-before-write is not atomic across tabs; cloud writes use revision CAS. Cloud supports 10,000 entries / 2 MB per payload; local/import validation has larger limits, so very large imports may remain local with a sync error. AI analysis accepts at most 500 combined selected/prior-month rows. Receipt interpretations still require user review. Trips do not split bills or convert currencies; income does not reduce trip spending. Undo history is session-local, and delete undo restores a row at the end of same-day insertion order.
