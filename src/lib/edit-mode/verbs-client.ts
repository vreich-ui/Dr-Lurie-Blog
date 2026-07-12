/**
 * Edit-mode canvas — the browser client for the object workflow.
 *
 * Thin wrappers over the SAME endpoints the admin object workspace uses
 * (admin-object / admin-ask-ai-object / admin-release / deploy-status), plus
 * an EditSession that owns one object's lock lifecycle (via the shared
 * LockManager) and record-version bookkeeping so callers just say
 * ensure-checkout → patch → publish. Nothing here writes outside those
 * endpoints; every mutation is the reviewable verb path.
 */
import { LockManager, type LockState } from '../admin/lock-manager.js';
import { requestObjectSuggestion, type ObjectSuggestionRequest } from '../admin/ask-ai-object-selection.js';

const OBJECT_ENDPOINT = '/.netlify/functions/admin-object';
const RELEASE_ENDPOINT = '/.netlify/functions/admin-release';
const AUTH_STATE_ENDPOINT = '/.netlify/functions/admin-auth-state';

export type GetToken = () => Promise<string>;

export type VerbResult = { status: number; body: Record<string, unknown> };

export const callObjectVerb = async (getToken: GetToken, body: Record<string, unknown>): Promise<VerbResult> => {
  const token = await getToken();
  const response = await fetch(OBJECT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
};

export type AdminAuthState = {
  authenticated: boolean;
  isAdmin: boolean;
  email?: string;
  roles?: string[];
};

export const fetchAdminAuthState = async (getToken: GetToken): Promise<AdminAuthState> => {
  const token = await getToken();
  if (!token) return { authenticated: false, isAdmin: false };
  const response = await fetch(AUTH_STATE_ENDPOINT, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  return (await response.json().catch(() => ({ authenticated: false, isAdmin: false }))) as AdminAuthState;
};

/** Display-only mirror of roles.ts canExecutePublish; the publish gate re-checks server-side. */
export const canExecutePublish = (roles: string[] | undefined): boolean =>
  Boolean(roles?.includes('admin') || roles?.includes('publisher'));

export const getObjectRecord = async (
  getToken: GetToken,
  objectType: string,
  objectId: string
): Promise<{ status: number; record?: Record<string, unknown> }> => {
  const result = await callObjectVerb(getToken, { action: 'get', object_type: objectType, object_id: objectId });
  return { status: result.status, record: result.body.record as Record<string, unknown> | undefined };
};

export type PendingObjectRow = {
  object_id: string;
  object_type: string;
  review_state: string;
  requires_approval: boolean;
  published_time: string | null;
  unpublished_changes: boolean;
  lock: { held: boolean; owner_label?: string; expires_at?: string };
};

export const fetchPendingObjects = async (getToken: GetToken): Promise<PendingObjectRow[]> => {
  const result = await callObjectVerb(getToken, { action: 'inventory', pending_changes: true, status: 'active' });
  if (result.status !== 200 || !Array.isArray(result.body.objects)) return [];
  return result.body.objects as PendingObjectRow[];
};

export const askAiSuggestion = (
  getToken: GetToken,
  request: ObjectSuggestionRequest
): ReturnType<typeof requestObjectSuggestion> => requestObjectSuggestion(request, getToken);

export type ReleaseResult = { ok: boolean; status: number; result?: { status: string; detail?: string } };

export const releaseToProduction = async (getToken: GetToken): Promise<ReleaseResult> => {
  const token = await getToken();
  const response = await fetch(RELEASE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, result: body.result as ReleaseResult['result'] };
};

export type PatchOutcome =
  | { ok: true; version: number }
  | { ok: false; status: number; error: string; blockers?: string[] };

/**
 * One object's editing session: lock lifecycle (shared LockManager — same
 * auto-refresh + unload beacon the admin surfaces use) plus record-version
 * tracking across patches. Create one per object touched, keep it for the
 * page's lifetime, `checkin()` on exit.
 */
export class EditSession {
  readonly objectType: string;
  readonly objectId: string;
  private getToken: GetToken;
  private lockManager: LockManager;
  private lockState: LockState = { held: false };
  private recordVersion: number | undefined;

  constructor(objectType: string, objectId: string, getToken: GetToken) {
    this.objectType = objectType;
    this.objectId = objectId;
    this.getToken = getToken;
    this.lockManager = new LockManager(objectId, getToken, {
      endpoint: OBJECT_ENDPOINT,
      buildRequestBody: (action, id, fields) => ({
        action: action === 'refresh' ? 'refresh_lock' : action,
        object_type: objectType,
        object_id: id,
        ...(fields.lockToken !== undefined ? { lock_token: fields.lockToken } : {}),
        ...(fields.leaseSeconds !== undefined ? { lease_seconds: fields.leaseSeconds } : {}),
      }),
    });
    this.lockManager.setOnStateChange((state) => {
      this.lockState = state;
    });
    this.lockManager.attachUnloadHandler();
  }

  get held(): boolean {
    return this.lockState.held;
  }

  /** Checkout if not already held. Returns the current holder's label when someone else has it. */
  async ensureCheckout(): Promise<{ ok: boolean; heldBy?: string }> {
    if (this.lockState.held) return { ok: true };
    const token = await this.lockManager.checkout();
    if (token) {
      // The checkout response body carries record_version, but LockManager
      // deliberately abstracts the wire body away — a cheap `get` keeps the
      // version bookkeeping exact (lock writes bump version, D§3.1).
      const { record } = await getObjectRecord(this.getToken, this.objectType, this.objectId);
      this.recordVersion = typeof record?.version === 'number' ? (record.version as number) : undefined;
      return { ok: true };
    }
    const agentLock = !this.lockState.held ? this.lockState.agentLock : undefined;
    return { ok: false, heldBy: agentLock?.owner_label };
  }

  /** Apply ops under the held lock; retries once on a version conflict (409). */
  async patch(ops: Array<Record<string, unknown>>): Promise<PatchOutcome> {
    if (!this.lockState.held) return { ok: false, status: 423, error: 'Lock not held' };
    if (this.recordVersion === undefined) {
      const { record } = await getObjectRecord(this.getToken, this.objectType, this.objectId);
      this.recordVersion = typeof record?.version === 'number' ? (record.version as number) : undefined;
      if (this.recordVersion === undefined) return { ok: false, status: 404, error: 'Record not found' };
    }
    const attempt = async (): Promise<VerbResult> =>
      callObjectVerb(this.getToken, {
        action: 'patch',
        object_type: this.objectType,
        object_id: this.objectId,
        lock_token: this.lockState.held ? this.lockState.lockToken : '',
        expected_record_version: this.recordVersion,
        ops,
      });

    let result = await attempt();
    if (result.status === 409 && typeof result.body.actual_record_version === 'number') {
      this.recordVersion = result.body.actual_record_version as number;
      result = await attempt();
    }
    if (result.status === 200) {
      this.recordVersion = result.body.version as number;
      return { ok: true, version: this.recordVersion };
    }
    const blockers = Array.isArray(result.body.blockers) ? (result.body.blockers as string[]) : undefined;
    return {
      ok: false,
      status: result.status,
      error: (result.body.error as string) ?? `Patch failed (${result.status})`,
      blockers,
    };
  }

  /** Publish the object's current draft (export-first commit; NOT a deploy). */
  async publish(): Promise<VerbResult> {
    if (!this.lockState.held) return { status: 423, body: { error: 'Lock not held' } };
    const result = await callObjectVerb(this.getToken, {
      action: 'publish_by_time',
      object_type: this.objectType,
      object_id: this.objectId,
      lock_token: this.lockState.held ? this.lockState.lockToken : '',
    });
    if (result.status === 200) this.recordVersion = undefined; // publish bumps version; refetch lazily
    return result;
  }

  async checkin(): Promise<void> {
    await this.lockManager.checkin();
    this.recordVersion = undefined;
  }
}
