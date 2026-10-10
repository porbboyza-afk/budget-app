# Budget replacement handoff — 2026-10-10

## Verified identity

Target: `https://github.com/porbboyza-afk/budget-app`.
Original baseline: `2689faa` (Restore Budget finance app).
Rebuild prepared in `rebuild/budget-ai` using an isolated worktree.
Original working tree has unrelated pending dashboard changes; they are excluded.

## Implemented

Earth palette, totals → quick entry → ledger, cent arithmetic, local persistence, JSON backup/restore and CSV.
Text/image AI proposals require review and explicit confirmation. Selected-month questions use server-computed totals.
Provider key is server-only; source env not copied. Production requires a verified allowed Google account and D1 quota.
Local server binds only loopback; production cannot enable local auth bypass through an environment flag.
Source reviewed independently. Build and synthetic CAS checks passed. Real DeepSeek text/image requests, Brave owner Google login, D1 CRUD/undo and refresh persistence passed. Only synthetic test records were used and removed; live ledger returned to zero.

## Before production replacement

User decision, 2026-10-10: old financial records are no longer wanted. Omit migration and start the replacement with an empty ledger. Source: user message “ข้อมูลเก่าทิ้งเลยไม่มีประโยชน์ละ”. No remote data was purged as part of this change.

1. Preserve source at baseline commit and legacy/budget-v1.html for code rollback.
2. New installations start empty; existing data written in the new draft is retained. The old Firestore schema is not read by the replacement.
3. Cloud sync implemented in D1, owner-scoped, revision CAS, periodic refresh and explicit backup/choice on conflict. Storage deletion pauses sync.
4. Owner allowlist set from existing authenticated Cloudflare owner; same Google account login verified in Brave. Firebase config reused from the original Budget source, domains extended without removing old domains. D1 quotas and server secrets configured. No provider keys copied into Git.
5. New host: budget-app-porbboyza.pages.dev. Original GitHub Pages root redirects there; other unrelated pages remain unchanged. Code rollback baseline preserved.

Production rollout follows the verified preview. Old-data migration is not required. Image verification used synthetic Thai fixtures, not a broad real-receipt corpus. Desktop and narrow-window layouts reviewed; no physical-phone test claimed.
