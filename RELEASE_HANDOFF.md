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
Source reviewed independently. Build completed. No new tests or paid API calls performed.

## Before production replacement

User decision, 2026-10-10: old financial records are no longer wanted. Omit migration and start the replacement with an empty ledger. Source: user message “ข้อมูลเก่าทิ้งเลยไม่มีประโยชน์ละ”. No remote data was purged as part of this change.

1. Preserve source at baseline commit and legacy/budget-v1.html for code rollback.
2. New installations start empty; existing data written in the new draft is retained. The old Firestore schema is not read by the replacement.
3. Decide and implement cloud sync for new records if required; AI login currently does not sync the ledger.
4. Configure owner email server-side, Firebase Google provider/domains, D1 quotas, Cloudflare secrets and output directory. GitHub Pages alone cannot run the paid AI server.
5. Verify API calls, Thai receipts/slips, login/denied accounts, quotas, duplicates, new-data backup restore and mobile layout before promoting the branch.

Production replacement is pending the remaining configuration and verification. Old-data migration is no longer a release requirement.
