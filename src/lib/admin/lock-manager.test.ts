import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { LockManager, type LockManagerConfig } from './lock-manager.js';

type RecordedCall = { url: string; body: unknown };

const mockFetch = (respond: (body: Record<string, unknown>) => Record<string, unknown>) => {
  const calls: RecordedCall[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(input), body });
    return new Response(JSON.stringify(respond(body)), { status: 200 });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
};

let restoreFetch: (() => void) | undefined;
afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
});

const getToken = async () => 'test-token';

describe('LockManager — default config (article editor) is byte-for-byte unchanged', () => {
  it('checkout POSTs the exact legacy body to the exact legacy endpoint', async () => {
    const mock = mockFetch(() => ({
      ok: true,
      lockToken: 'tok-1',
      lock: { owner_id: 'a', owner_label: 'a', acquired_at: 'x', expires_at: 'y' },
    }));
    restoreFetch = mock.restore;

    const manager = new LockManager('req_smoke_pdf_cta_20260630_01', getToken);
    const token = await manager.checkout(900);

    assert.equal(token, 'tok-1');
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].url, '/.netlify/functions/admin-workflow-lock');
    assert.deepEqual(mock.calls[0].body, {
      action: 'checkout',
      requestId: 'req_smoke_pdf_cta_20260630_01',
      leaseSeconds: 900,
    });

    // A successful checkout schedules a real refresh timer; clear it via
    // checkin so it doesn't keep the process alive after this test returns.
    const cleanup = mockFetch(() => ({ ok: true }));
    restoreFetch = cleanup.restore;
    await manager.checkin();
  });

  it('checkin POSTs {action, requestId, lockToken} with no leaseSeconds field', async () => {
    const manager = new LockManager('req_x', getToken);

    const checkoutMock = mockFetch(() => ({
      ok: true,
      lockToken: 'tok-2',
      lock: { owner_id: 'a', owner_label: 'a', acquired_at: 'x', expires_at: 'y' },
    }));
    restoreFetch = checkoutMock.restore;
    await manager.checkout();

    const checkinMock = mockFetch(() => ({ ok: true }));
    restoreFetch = checkinMock.restore;
    await manager.checkin();

    assert.equal(checkinMock.calls.length, 1);
    assert.equal(checkinMock.calls[0].url, '/.netlify/functions/admin-workflow-lock');
    assert.deepEqual(checkinMock.calls[0].body, { action: 'checkin', requestId: 'req_x', lockToken: 'tok-2' });
  });

  it('status POSTs {action, requestId} only', async () => {
    const mock = mockFetch(() => ({ ok: true }));
    restoreFetch = mock.restore;
    const manager = new LockManager('req_y', getToken);
    await manager.status();
    assert.deepEqual(mock.calls[0].body, { action: 'status', requestId: 'req_y' });
  });

  it('forceRelease POSTs {action, requestId} only', async () => {
    const mock = mockFetch(() => ({ ok: true }));
    restoreFetch = mock.restore;
    const manager = new LockManager('req_z', getToken);
    await manager.forceRelease();
    assert.deepEqual(mock.calls[0].body, { action: 'force_release', requestId: 'req_z' });
  });

  it('a denied checkout surfaces the agent lock and returns null, unchanged from today', async () => {
    const mock = mockFetch(() => ({
      ok: false,
      locked: true,
      lock: { owner_id: 'other', owner_label: 'other@example.com', acquired_at: 'x', expires_at: 'y' },
    }));
    restoreFetch = mock.restore;

    const manager = new LockManager('req_conflict', getToken);
    const states: unknown[] = [];
    manager.setOnStateChange((state) => states.push(state));
    const token = await manager.checkout();

    assert.equal(token, null);
    assert.deepEqual(states, [{ held: false, agentLock: { owner_label: 'other@example.com', expires_at: 'y' } }]);
  });
});

describe('LockManager — parameterized config (objects surface, T1.5)', () => {
  const objectLockConfig: LockManagerConfig = {
    endpoint: '/.netlify/functions/admin-object',
    buildRequestBody: (action, objectId, fields) => ({
      action: action === 'refresh' ? 'refresh_lock' : action,
      object_type: 'navigation',
      object_id: objectId,
      ...(fields.lockToken !== undefined ? { lock_token: fields.lockToken } : {}),
      ...(fields.leaseSeconds !== undefined ? { lease_seconds: fields.leaseSeconds } : {}),
    }),
  };

  it('checkout speaks the object-verbs wire shape at the object endpoint', async () => {
    const mock = mockFetch(() => ({
      ok: true,
      lockToken: 'tok-obj',
      lock: { owner_id: 'h', owner_label: 'h', acquired_at: 'x', expires_at: 'y' },
    }));
    restoreFetch = mock.restore;

    const manager = new LockManager('nav_footer', getToken, objectLockConfig);
    const token = await manager.checkout(600);

    assert.equal(token, 'tok-obj');
    assert.equal(mock.calls[0].url, '/.netlify/functions/admin-object');
    assert.deepEqual(mock.calls[0].body, {
      action: 'checkout',
      object_type: 'navigation',
      object_id: 'nav_footer',
      lease_seconds: 600,
    });

    const cleanup = mockFetch(() => ({ ok: true }));
    restoreFetch = cleanup.restore;
    await manager.checkin();
  });

  it("refresh maps the internal action name 'refresh' to the wire action 'refresh_lock'", async () => {
    const checkoutMock = mockFetch(() => ({
      ok: true,
      lockToken: 'tok-obj',
      lock: { owner_id: 'h', owner_label: 'h', acquired_at: 'x', expires_at: 'y' },
    }));
    restoreFetch = checkoutMock.restore;
    const manager = new LockManager('nav_footer', getToken, objectLockConfig);
    await manager.checkout(600);

    const refreshMock = mockFetch(() => ({
      ok: true,
      lock: { owner_id: 'h', owner_label: 'h', acquired_at: 'x', expires_at: 'y2' },
    }));
    restoreFetch = refreshMock.restore;
    // Exercise the same request-building path doRefresh uses, without waiting on the real timer.
    await (manager as unknown as { doRefresh(leaseSeconds: number): Promise<void> }).doRefresh(600);

    assert.deepEqual(refreshMock.calls[0].body, {
      action: 'refresh_lock',
      object_type: 'navigation',
      object_id: 'nav_footer',
      lock_token: 'tok-obj',
      lease_seconds: 600,
    });

    // checkout() scheduled one refresh timer and the manual doRefresh() call
    // above scheduled a second on its success path; checkin clears whichever
    // is still pending so no real timer outlives this test.
    const cleanup = mockFetch(() => ({ ok: true }));
    restoreFetch = cleanup.restore;
    await manager.checkin();
  });

  it('checkin uses lock_token (snake_case) via the object config', async () => {
    const checkoutMock = mockFetch(() => ({
      ok: true,
      lockToken: 'tok-ci',
      lock: { owner_id: 'h', owner_label: 'h', acquired_at: 'x', expires_at: 'y' },
    }));
    restoreFetch = checkoutMock.restore;
    const manager = new LockManager('nav_footer', getToken, objectLockConfig);
    await manager.checkout();

    const checkinMock = mockFetch(() => ({ ok: true, checked_in: true }));
    restoreFetch = checkinMock.restore;
    await manager.checkin();

    assert.deepEqual(checkinMock.calls[0].body, {
      action: 'checkin',
      object_type: 'navigation',
      object_id: 'nav_footer',
      lock_token: 'tok-ci',
    });
  });
});
