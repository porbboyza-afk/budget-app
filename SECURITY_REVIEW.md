# จดเงิน: preventative security review — 2026-10-14

## Live checks and changes

The Firebase project and API key were matched to the maintained app configuration before changing permissions. Administrative requests used the existing Firebase CLI login through bounded REST calls; credentials remained in memory. The previous key restriction metadata is backed up under ignored `.local/security-review-20261014/` for rollback.

- Retrieved the deployed Firestore rules. They require a signed-in UID matching the user path for both legacy data paths; other paths are denied. Thirteen Rules API simulator cases passed using synthetic UIDs: anonymous and cross-owner reads/writes denied, own paths allowed, unmatched paths denied. The rules contain no database lookup functions; these test contexts did not read or write financial records. No rule deployment was necessary.
- Reduced the actual Firebase key from 27 service targets to only `identitytoolkit.googleapis.com` and `securetoken.googleapis.com`, the two services required by this app's Authentication. The change used the existing key etag and was reread after completion. Both auth services still accept requests and reject invalid credentials. An unauthenticated synthetic Firestore probe returns 403.
- Verified Google sign-in is enabled and authorized domains include the current production/preview app. Domain restrictions govern browser sign-in; they do not replace server authorization.
- Browser referrer restrictions are not added to this shared key because the server also uses it for account lookup without a browser referrer. The service allowlist limits scope. Firebase web keys are identifiers, not passwords; do not reuse this key for paid Google APIs. [Firebase API key guidance](https://firebase.google.com/docs/projects/api-keys).

## Server prevention

`server/auth-token.js` uses pinned JOSE to verify RS256 signatures against the fixed Google securetoken public JWKS endpoint before any Firebase account lookup. It rejects malformed headers, untrusted key sources, expired/future/invalid time claims, wrong issuer/audience and invalid subjects. Unverified decoding is used only to reject requests, never to grant access. Verified email claims must match the owner allowlist before account lookup.

Account lookup retains authoritative UID/current verified-email checks and rejects disabled accounts or sessions predating `validSince`. D1 queries continue to bind authenticated UID; provider keys remain server-only. Production functions cannot enable the local preview bypass through environment values.

Public signing keys are cached with bounded fetches and refresh cooldowns. A worker-isolate gate permits one cold key refresh through response parsing; concurrent refreshes return transient 503 without sharing request-owned I/O. Cached matching keys remain usable; actual invalid tokens return 401. Signing-service failure denies access; this prevents accepting unverifiable tokens. These protections mitigate forged-token authentication-quota abuse; they are not a global rate limit across worker isolates and do not promise protection from every distributed denial-of-service attack or someone possessing a valid owner token. [Firebase token verification requirements](https://firebase.google.com/docs/auth/admin/verify-id-tokens).

## Verification and maintenance

Synthetic tests use ephemeral RSA keys and mocked JWKS/account/D1/provider responses. They verify valid-token behavior and deny unsigned, forged, expired, wrong-key/project, excluded-account, disabled and revoked tokens before data access. Browser/PWA tests remain isolated from the user's profile and actual provider billing. Public packaging excludes server modules, dependencies, test fixtures, notes and credentials.

The final Node suite passed 66 TAP tests. A separate reviewer checked signature trust, authorization and the Cloudflare-shaped concurrent refresh case; no blocking flaw was identified. Preview Functions compiled with JOSE. Live key restrictions, deployed Rules and unauthenticated endpoint rejection were checked separately from synthetic tokens. The initial pass did not verify current-owner interactive login; the follow-up below completes that check. No new user account or financial record was created.

### Real owner login follow-up — 2026-10-14

Verified in the user's existing normal Brave profile on production. The agent and Brave were both in Windows session 2; the old UI helper incorrectly required an already-open Budget tab, so it failed to find Brave when another site was active. The helper now opens a new app tab before targeting the app window.

The existing real session returned ledger HTTP 200. Exercised app logout, the actual Google popup sign-in back to the same account, page reload and forced `getIdToken(true)` renewal. All passed; the signed-in avatar returned and the production ledger API again returned 200. Local data SHA-256 and cloud revision stayed equal to the pre-logout baseline, and cloud state matched local state. Account identity was compared in memory; no identity, token or ledger contents were written into this report.

The AI endpoint accepted the real account authorization and then returned the expected 400 for a deliberately invalid command, which stops before quota reservation or provider invocation. No paid AI call or financial-record write was made. Temporary hash-only session-storage probes were removed, DevTools closed, and the user was left signed in. This was a desktop Brave test, not a physical-phone test.

Install locked dependencies with `npm ci`; run `npm test`, `npm run format:check`, `npm run build`, and the documented optional Brave audits. JOSE is a server runtime dependency bundled into Pages Functions; it is not shipped as a public browser asset. The production dependency advisory check reported zero known vulnerabilities on this date.

Source rollback: `backup/jodngern-before-security-hardening-20261014`. Key rollback is separate from Git: restore the backed-up restriction metadata through the authenticated API if needed. Do not publish `.local/`, Firebase CLI credentials, account configuration backups or bearer tokens. Recheck cloud settings when adding Android, Firebase services, domains or additional owners; the current restrictions intentionally cover this web app's authentication only.
