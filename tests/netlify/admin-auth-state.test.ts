import assert from 'node:assert/strict';
import test from 'node:test';

import { handler } from '../../netlify/functions/admin-auth-state.js';

const ENV_KEYS = ['ROLE_EMAILS_ADMIN', 'ROLE_EMAILS_PUBLISHER', 'ROLE_EMAILS_EDITOR', 'ADMIN_EMAILS'] as const;
const withRoleEnv = async (env: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => Promise<void>) => {
  const saved = ENV_KEYS.map((key) => [key, process.env[key]] as const);
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  try {
    await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

const contextFor = (email: string) => ({ clientContext: { user: { sub: 'user-1', email } } });

test('admin-auth-state reports the resolved roles for an authenticated identity (T1.4/T1.5)', async () => {
  await withRoleEnv({ ROLE_EMAILS_ADMIN: 'admin@example.com', ROLE_EMAILS_EDITOR: 'admin@example.com' }, async () => {
    const response = await handler({ httpMethod: 'GET' }, contextFor('admin@example.com'));
    const body = JSON.parse(response.body);
    assert.equal(body.authenticated, true);
    assert.deepEqual(body.roles, ['admin', 'editor']);
  });
});

test('admin-auth-state reports no roles for an identity with none configured', async () => {
  await withRoleEnv({ ADMIN_EMAILS: 'someone-else@example.com' }, async () => {
    const response = await handler({ httpMethod: 'GET' }, contextFor('stranger@example.com'));
    const body = JSON.parse(response.body);
    assert.equal(body.authenticated, true);
    assert.deepEqual(body.roles, []);
  });
});

test('admin-auth-state reports no roles when unauthenticated', async () => {
  const response = await handler({ httpMethod: 'GET' });
  const body = JSON.parse(response.body);
  assert.equal(body.authenticated, false);
  assert.deepEqual(body.roles, []);
});
