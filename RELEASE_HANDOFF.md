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

1. Preserve old source at baseline commit and legacy/budget-v1.html; this is a code backup, not a user-data backup.
2. Export and verify old browser data and the signed-in user's Firestore monthlyData. Never copy financial records to Git.
3. Implement read-only conversion with explicit year/date selection: old data has month slots and may lack dates/years. Never invent a date or double-count carry/summary totals/pocket details. Show preview and compare counts/totals before import.
4. Keep old Firestore documents untouched. New schema needs its own path if cloud sync is added; AI login currently does not sync ledger data.
5. Configure owner email server-side, Firebase Google provider/domains, D1 quotas, Cloudflare secrets and output directory. GitHub Pages alone cannot run the paid AI server.
6. Verify API calls, Thai receipts/slips, login/denied accounts, quota, duplicates, backup restore, mobile layout and migration before promoting the branch.

Production replacement is pending those steps. Reverting source cannot recover missing browser data; verify backups before switching.
