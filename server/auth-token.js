import { createRemoteJWKSet, customFetch, decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';

// Fixed trusted issuer keys; never follow a token's jku/x5u or embedded JWK.
const GOOGLE_KEYS = new URL(
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
);
export class TokenKeyServiceError extends Error {
  constructor(busy = false) {
    super(busy ? 'Signing keys fetch in progress' : 'Signing keys temporarily unavailable');
    this.busy = busy;
  }
}
let retryKeysAfter = 0,
  resolvingFetch = false,
  fetchingHTTP = false;
const keys = createRemoteJWKSet(GOOGLE_KEYS, {
  timeoutDuration: 5000,
  cooldownDuration: 60000,
  cacheMaxAge: 10 * 60 * 1000,
  [customFetch]: async (...args) => {
    if (fetchingHTTP) throw new TokenKeyServiceError(true);
    if (Date.now() < retryKeysAfter) throw new TokenKeyServiceError();
    fetchingHTTP = true;
    try {
      return await fetch(...args);
    } finally {
      fetchingHTTP = false;
    }
  },
});
function checkClaims(payload, project) {
  const now = Math.floor(Date.now() / 1000);
  if (
    payload.aud !== project ||
    payload.iss !== `https://securetoken.google.com/${project}` ||
    typeof payload.sub !== 'string' ||
    !payload.sub ||
    payload.sub.length > 128 ||
    !Number.isSafeInteger(payload.iat) ||
    payload.iat > now ||
    !Number.isSafeInteger(payload.auth_time) ||
    payload.auth_time > now ||
    !Number.isSafeInteger(payload.exp) ||
    payload.exp <= now ||
    payload.exp <= payload.iat ||
    payload.auth_time > payload.iat
  )
    throw new Error('Invalid token claims');
}
async function verifiedKey(...args) {
  // Workers deliberately avoid sharing request-owned I/O in jose. Reject another
  // refresh transiently instead, including the response-body/cache-apply phase.
  // Already cached matching keys remain available to concurrent valid requests.
  const mustFetch =
    !keys.fresh || (!keys.coolingDown && !keys.jwks()?.keys.some((key) => key.kid === args[0].kid));
  if (mustFetch && resolvingFetch) throw new TokenKeyServiceError(true);
  if (mustFetch) resolvingFetch = true;
  try {
    return await keys(...args);
  } catch (error) {
    if (error instanceof TokenKeyServiceError) throw error;
    // jose's normal cooldown covers unknown kids; failed fetches need a cooldown too.
    if (error.code === 'ERR_JWKS_NO_MATCHING_KEY') throw error;
    if (Date.now() >= retryKeysAfter) retryKeysAfter = Date.now() + 60000;
    throw new TokenKeyServiceError();
  } finally {
    if (mustFetch) resolvingFetch = false;
  }
}
export async function verifyFirebaseToken(token, project) {
  const header = decodeProtectedHeader(token);
  if (
    header.alg !== 'RS256' ||
    typeof header.kid !== 'string' ||
    !header.kid ||
    header.kid.length > 128
  )
    throw new Error('Invalid token header');
  // Unverified claims only reject obvious bad requests; they never grant access.
  checkClaims(decodeJwt(token), project);
  const { payload } = await jwtVerify(token, verifiedKey, {
    algorithms: ['RS256'],
    issuer: `https://securetoken.google.com/${project}`,
    audience: project,
    requiredClaims: ['exp', 'iat', 'auth_time', 'sub'],
    clockTolerance: 0,
  });
  checkClaims(payload, project);
  return payload;
}
