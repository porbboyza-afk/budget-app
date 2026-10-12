# Budget replacement handoff — 2026-10-10

## Code cleanup and Android preparation — 2026-10-12

User requested a code-quality check and orderly base for later Android development. Added platform-independent ledger-domain.js for queries, paging, AI context/proposal validation and guarded undo; ledger-repository.js centralizes validated local/cloud writes, legacy recovery and scoped preferences using an injected synchronous storage interface; ui-format.js removes duplicate web formatting. Extracted AI dialog/image handling into ai-ui.js. app.js remains web orchestration and trips.js remains web presentation. API/schema/owner keys unchanged. Public module allowlist and offline shell include new dependencies.

Pinned development-only Prettier 3.6.2 plus lock/config/ignore; formatted maintained source while excluding env, dist, archived source and unrelated artifacts. CSS cascade order is preserved rather than silently deleting overrides. Added AGENTS.md after confirming none existed in this repository, and ARCHITECTURE.md with module boundaries, data contract and unfinished Android work (async transactional storage, account/token, request origin, files/images, lifecycle and device checks). This remains a web/PWA release, not an Android build.

Fixed stale AI rejection/finally handlers that could modify current UI after account/dialog changes. Independent reviewer found a damaged-JSON restore bug; repository now safely detects legacy/repair snapshots, preserves malformed or null original raw before repair, and distinguishes missing data from damaged saved JSON. Fixed build cache placeholder matching to tolerate source formatting. Verification: 16 synthetic Node tests passed, including money/schema/trip semantics, undo, owner-scoped repository/recovery, damaged-data restore and public dependency/cache coverage; formatting check and public build passed. No real ledger writes or paid AI calls used. Source rollback: backup/jodngern-before-cleanup-20261012. See prior sections for older device verification; automated checks here are not Android/device evidence.

## Approved travel and daily-entry enhancements — 2026-10-11

User approved all five proposals (“จัดมาให้หมด”): quick manual entry, recent-save edit/undo, top-three expense categories, focused AI actions, fewer decorative texts, and the travel-budget feature described alongside those proposals. Added fifth route /#trips. Trip lists paginate six, trip transaction lists ten; monthly ledger remains ten with trip filter. A trip stores name, travel dates, optional budget, archived status; original transactions carry tripId, so monthly and trip totals count each expense once. Trip totals span all linked dates, including advance payments outside travel dates. Income is shown in trip rows but does not subtract from the spending figure. No multi-currency or bill splitting.

Schema version 2 reads version 1 backups/local/cloud records; original local v1 is preserved under the owner's :before-version2 key before first actual commit. PUT requires raw v2 (426 for old clients); GET normalizes legacy data. Server CAS and owner auth unchanged; no SQL migration/data purge. Legacy cross-tab overwrites while trips exist trigger a recoverable v2 snapshot/download, commit block and sync pause. Reload can use the recovery snapshot, pending explicit restore or cloud/local choice. Explicit restore and accepted v2 events reconfigure paused sync; normal conflict checks still apply. Account-scoped preference remembers active trip. Closing/archiving a trip retains all data and preserves pending drafts.

Manual amount is first; category chips and optional trip selector follow. AI actions appear after the form: multiple-entry extraction, receipt/slip reading, and explanation/comparison from recorded expenses. AI candidates expose editable trip selection. Questions include selected and preceding months (combined <=500), with server-recomputed totals and explicit incomplete-history guidance. AI stays user-triggered; no provider request is made just by viewing categories. Recent save supports safe row-equality checked undo for a single edit/add or AI batch; this session-only undo is cleared on restore/account change. Reopening the same editing row preserves draft; replacing another draft asks first. Restore protects initiating owner/raw across async file reads, and token preparation checks owner before sending AI data.

Independent agents reviewed UI/data/sync/security source and fixes. Preview overview, manual-entry and empty-trip screens visually inspected in narrow desktop Brave; not physical Samsung S25 FE. No automated tests, sample financial writes or new paid AI calls performed for this release. Earlier live verification below belongs to earlier releases, not proof of the new trip flows. Rollback source branch: backup/jodngern-before-trips-20261011; rollback must retain v2 records because old code cannot read trips. User should update every open/PWA instance via ข้อมูล → อัปเดตแอป.

## จดเงิน and compact account — 2026-10-11

User renamed the visible app to จดเงิน and reported oversized account photo/status on Samsung S25 FE. Branding, page titles, installation text, manifest names and notebook icons now use จดเงิน. Hosting/repository names, manifest ID, data keys and account scope remain stable. Icons are generated by scripts/generate-icons.py (Python/Pillow and Windows Tahoma font).

On mobile/tablet the account control sits at the top right beside the brand, above navigation; its photo is 30px inside a 44px touch target with a 9px signed-in dot. Routine account messages stay available to assistive technology; auth errors and offline notices remain visible. The account dialog still shows identity and explicit logout. No device reset or profile modifications are involved. Travel-expense grouping is a proposal only, not yet implemented.

Independent source review found no layout blocker; fixed the retry action's accessible label and remaining old-brand import error. Preview inspected in a narrow desktop Brave window, not an actual Samsung S25 FE. No automated tests or new paid AI calls were run. User-facing trip proposal: optional trip name/dates/budget, associate normal expense rows without duplicate recording, show trip spending/remaining budget across month boundaries. Multi-currency conversion and shared-bill settlement are deferred ideas, not implemented requirements. Keep transaction entry simple and maintain existing personal/month totals.

## Separate views — 2026-10-11

Latest user steering supersedes the earlier single-page preference: fixed top menu on mobile and separate compact destinations. Added views.js with four hash routes: overview, entry-panel, transactions, data-tools. Only the active panel is shown; switching panels preserves mounted form/list state, supports browser back/forward and direct links, and avoids reinitializing auth or sync. Editing a ledger row opens the entry screen; summary's return-to-entry action does likewise. The month selector remains available for overview/list/CSV-data screens; entry uses its explicit date. Sync conflicts announce once and mark the data menu so hidden tools cannot silently conceal a conflict. views.js is public-build allowlisted and precached for offline navigation. This update includes the requested signed-in avatar and green dot.

Independent review identified startup typing loss and month-change draft clearing. Entry controls are now disabled with a loading message until account/local-state initialization completes; switching reporting months no longer resets the entry form. Persistent data-menu conflict marker plus one-time notice address conflicts while the data screen is hidden.

Cloud refresh also preserves the manual draft; existing stale-edit checks still reject edits to remotely changed rows. Independent follow-up source review found no remaining blocker. All four screens were visually inspected in a narrow Brave desktop window on preview; this was not a physical-phone check or live signed-in-avatar verification. Public-asset build and git diff whitespace checks passed. No automated tests or paid AI calls were run for this update.

Cloud refresh also preserves the manual draft; existing stale-edit checks still reject edits to remotely changed rows. Independent follow-up source review found no remaining blocker. All four screens were visually inspected in a narrow Brave desktop window on preview; this was not a physical-phone check or live signed-in-avatar verification. Public-asset build and git diff whitespace checks passed. No automated tests or paid AI calls were run for this update.

## Account avatar — 2026-10-11

User requested a small circular account photo and green indicator after Google login. Header now renders the authenticated user's Google photo (HTTPS lh-number.googleusercontent.com only), with initial fallback if absent/blocked. The green dot means signed in, not proof of successful cloud sync. Button retains an accessible label and opens the account dialog; sign-out and startup fallback remove the avatar. Photo URLs/identity are not stored in persistent notes or copied to Git. CSP allows Googleusercontent images; service worker does not intercept or cache external profile requests. Other app colors remain unchanged.

## One-page organization and pagination — 2026-10-11

User approved preserving the simple single page while organizing controls and limiting long lists. Account/login is a compact top-right control independent of the money form; signed-in users open a separate account dialog before logout. Shortcuts are จด / รายการ / ข้อมูล anchors. Month, totals, monthly summary and money questions are grouped; AI text/image entry buttons appear before manual fields. Sync, backup/restore/CSV and PWA tools share one data section.

Ledger renders at most 10 matching monthly rows per page, with range, page count and previous/next controls. Search/type filter cover the full month before slicing. Month/filter/save/restore/account changes reset page; deletion and async updates clamp to valid bounds. Totals, CSV and AI context retain their existing complete-data semantics. Data schema and owner-scoped storage are unchanged.

Independent source review found no blocker in pagination, relocated IDs/listeners or account/AI actions. Narrow Brave preview visually inspected (desktop window resized, not a physical phone). No automated test suite or new paid AI calls run in this change. Account dialog displays the current account identity via textContent, without copying it into documentation.

## Mobile account access — 2026-10-11

User reported missing/unusable login on smartphone. Code placed the only login button after the entire entry form and AI tools. Moved account controls directly below the page header, before totals and entry, with a full-width 48px button on small screens. Auth startup now bounds config/SDK/session waits, avoids AbortSignal.timeout compatibility dependency, exposes retry on failure, and distinguishes blocked/cancelled popups, network, unsupported storage and unauthorized domain. Google popup remains invoked directly from the click; no cross-domain redirect flow was added. No physical smartphone login verification claimed.

Independent review identified and fixed late Firebase initialization after a timeout (clear the auth/token source before local fallback), and kept config body parsing inside the abort timeout. This prevents fallback local account scope from silently receiving another account's token.

## PWA follow-up — 2026-10-10

User authorized PWA, a more dimensional earth palette with additional colors, press effects, and GitHub push. Added standalone Thai manifest, 192/512 PNG icons, public-shell-only service worker, install/update controls and iPhone instructions. Offline startup reads the last signed-in owner's local scope; this pointer carries no token and does not authorize any server request. AI/auth/cloud remain online services. Offline opening before any successful online visit is unsupported. Browser data clearing still requires an external backup. Palette now includes dusty blue, sand, terracotta and muted plum; reduced-motion is respected.

Independent security source review passed after fixing cache versioning: build embeds a SHA-256 asset digest in the deployed worker, isolating pending releases from the active cache. Actual Brave preview showed an activated controller, standalone manifest, 192/512 icons and 13 public-only cached URLs. Production online installation and subsequent reload with DevTools network emulation set to Offline rendered the app from the service worker with its offline notice. Connection restored after checking. Desktop layout viewed; installation on a physical phone has not been verified.

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
