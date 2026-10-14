# Native API support — 2026-10-14

Base: `28011ac` in `porbboyza-afk/budget-app`. Maintained branch: `native/android-api`.

Change: permit requests without an Origin header for POST `/api/ai` and PUT `/api/ledger`. Requests with an explicit foreign, opaque (`null`) or empty Origin remain rejected. Authentication still verifies Firebase RS256 against fixed Google JWKS, current allowed verified email, disabled-account and revocation state. D1 owner scope, revision CAS and AI quota/provider handling remain intact. There is no anonymous native mode or wildcard CORS.

Verification: 77 synthetic Node tests pass, including 11 native-origin/auth cases added to the baseline 66. `npm run build` produces the public allowlisted output. Formatting checked on modified source files only; baseline formatting issues outside this patch are not part of this change. No production deployment, paid provider request or real ledger mutation in these checks.

The native project is `../jodngern-native`. Its original `backend-patch/server` files are historical references, not replacement instructions for this hardened backend. Before deployment review `git diff`, then deploy the maintained web build with Pages Functions using the existing release workflow. No database or token migration required.
