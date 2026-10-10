# Budget replacement handoff — 2026-10-10

## PWA follow-up — 2026-10-10

User authorized PWA, a more dimensional earth palette with additional colors, press effects, and GitHub push. Added standalone Thai manifest, 192/512 PNG icons, public-shell-only service worker, install/update controls and iPhone instructions. Offline startup reads the last signed-in owner's local scope; this pointer carries no token and does not authorize any server request. AI/auth/cloud remain online services. Offline opening before any successful online visit is unsupported. Browser data clearing still requires an external backup. Palette now includes dusty blue, sand, terracotta and muted plum; reduced-motion is respected.

Independent security source review passed after fixing cache versioning: build embeds a SHA-256 asset digest in the deployed worker, isolating pending releases from the active cache. Actual Brave preview showed an activated controller, standalone manifest, 192/512 icons and 13 public-only cached URLs. Desktop layout viewed. Offline reload and installation on a physical phone have not been verified.

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
