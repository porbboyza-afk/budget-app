import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAI } from '../server/ai.js';
import { handleLedger } from '../server/ledger.js';
const env = {
  FIREBASE_PROJECT_ID: 'synthetic-project',
  FIREBASE_WEB_API_KEY: 'synthetic-public-config',
  BUDGET_ALLOWED_EMAILS: 'owner@synthetic.invalid',
};

for (const [name, handler, method] of [
  ['ai', handleAI, 'POST'],
  ['ledger', handleLedger, 'PUT'],
]) {
  test(`${name}: native request still requires authentication`, async () => {
    const response = await handler(
      new Request(`https://synthetic.invalid/api/${name}`, { method }),
      env,
    );
    assert.equal(response.status, 401);
  });
  test(`${name}: malformed native bearer token is rejected`, async () => {
    const response = await handler(
      new Request(`https://synthetic.invalid/api/${name}`, {
        method,
        headers: { Authorization: 'Bearer forged.token.value' },
      }),
      env,
    );
    assert.equal(response.status, 401);
  });
  for (const origin of ['https://foreign.invalid', 'null', '']) {
    test(`${name}: explicit foreign/opaque/empty browser origin is blocked (${origin})`, async () => {
      const response = await handler(
        new Request(`https://synthetic.invalid/api/${name}`, {
          method,
          headers: { Origin: origin },
        }),
        env,
      );
      assert.equal(response.status, 403);
    });
  }
}
