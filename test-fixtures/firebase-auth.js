import { generateKeyPairSync, sign } from 'node:crypto';

// Ephemeral test-only keypair. Never written to disk or accepted by live Google JWKS.
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
export const publicJWKS = {
  keys: [
    {
      ...pair.publicKey.export({ format: 'jwk' }),
      alg: 'RS256',
      use: 'sig',
      kid: 'synthetic-test-key',
    },
  ],
};
export function firebaseToken(project, owner, changes = {}, headerChanges = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', kid: 'synthetic-test-key', typ: 'JWT', ...headerChanges }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      aud: project,
      iss: `https://securetoken.google.com/${project}`,
      sub: owner,
      email: 'synthetic@example.invalid',
      email_verified: true,
      iat: now - 30,
      auth_time: now - 60,
      exp: now + 3600,
      ...changes,
    }),
  ).toString('base64url');
  const input = header + '.' + payload;
  return (
    input + '.' + sign('RSA-SHA256', Buffer.from(input), pair.privateKey).toString('base64url')
  );
}
