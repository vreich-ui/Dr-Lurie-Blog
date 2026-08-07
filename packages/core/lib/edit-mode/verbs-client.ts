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
const UPLOAD_INTENT_ENDPOINT = '/.netlify/functions/admin-artifact-upload-intent';
const ARTIFACT_UPLOAD_ENDPOINT = '/api/artifacts/upload';

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

export type UploadImageResult = { ok: true; publicPath: string } | { ok: false; error: string };

/**
 * Push an image into the blobs `artifacts` store — the pdf-tool pattern for
 * canvas images. Two steps, no new write path: (1) the admin-gated intent
 * endpoint signs the upload claims (identity token proves the human), (2) the
 * bytes go to the SAME /api/artifacts/upload the agents use, gated by that
 * signed token. Returns the public /img/* path (get-public-image) to put in
 * the section's `src` — storage only; the src change itself still goes
 * through the reviewable draft path.
 */
export const uploadImageArtifact = async (
  getToken: GetToken,
  objectId: string,
  file: { arrayBuffer(): Promise<ArrayBuffer>; type: string; size: number }
): Promise<UploadImageResult> => {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  const token = await getToken();
  const intentResponse = await fetch(UPLOAD_INTENT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ object_id: objectId, content_type: file.type, size_bytes: file.size, sha256 }),
  });
  const intent = (await intentResponse.json().catch(() => ({}))) as {
    token?: string;
    claims?: { requestId: string; artifactKind: string; contentType: string; filename?: string };
    publicPath?: string;
    error?: string;
  };
  if (!intentResponse.ok || !intent.token || !intent.claims || !intent.publicPath) {
    return { ok: false, error: intent.error ?? `Upload intent failed (${intentResponse.status})` };
  }

  const uploadResponse = await fetch(ARTIFACT_UPLOAD_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${intent.token}`,
      'Content-Type': 'application/octet-stream',
      'X-Artifact-Request-Id': intent.claims.requestId,
      'X-Artifact-Kind': intent.claims.artifactKind,
      'X-Artifact-Content-Type': intent.claims.contentType,
      'X-Artifact-Size': String(file.size),
      'X-Artifact-Sha256': sha256,
      ...(intent.claims.filename ? { 'X-Artifact-Filename': intent.claims.filename } : {}),
    },
    body: bytes,
  });
  const upload = (await uploadResponse.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!uploadResponse.ok || !upload.ok) {
    return { ok: false, error: upload.error ?? `Upload failed (${uploadResponse.status})` };
  }

  return { ok: true, publicPath: intent.publicPath };
};

export type EnsureBlobImageResult = { ok: true; publicPath: string; mirrored: boolean } | { ok: false; error: string };

const MIRRORABLE_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

/**
 * Guarantee an image has a blob-store copy with a public /img/* address, so
 * agents and external image tooling can fetch and manipulate the exact bytes.
 * Already blob-backed srcs pass through untouched; anything else (repo images
 * like /images/…, hashed build assets) is fetched same-origin and pushed
 * through the SAME intent → /api/artifacts/upload pipeline as a manual
 * upload. Content-addressed keys make re-mirroring the same bytes a no-op
 * (the store dedupes). Mirroring never changes the object — the section keeps
 * its current src; the blob copy simply exists alongside it.
 */
export const ensureBlobBackedImage = async (
  getToken: GetToken,
  objectId: string,
  src: string
): Promise<EnsureBlobImageResult> => {
  if (/^\/img\//.test(src)) return { ok: true, publicPath: src, mirrored: false };

  let response: Response;
  try {
    response = await fetch(src, { credentials: 'omit' });
  } catch {
    return { ok: false, error: `Could not fetch ${src}` };
  }
  if (!response.ok) return { ok: false, error: `Could not fetch ${src} (HTTP ${response.status})` };

  const contentType = (response.headers.get('content-type') ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
  if (!MIRRORABLE_IMAGE_TYPES.has(contentType)) {
    return {
      ok: false,
      error: `Only JPEG/PNG/WebP images can be mirrored into blobs (got ${contentType || 'unknown'}).`,
    };
  }

  const blob = await response.blob();
  const upload = await uploadImageArtifact(getToken, objectId, {
    arrayBuffer: () => blob.arrayBuffer(),
    type: contentType,
    size: blob.size,
  });
  if (!upload.ok) return upload;
  return { ok: true, publicPath: upload.publicPath, mirrored: true };
};

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

/** Ids the endpoint minted for id-less op payloads (e.g. a quick-added section). */
export type MintedId = { index: number; field: string; id: string };

export type PatchOutcome =
  | { ok: true; version: number; minted: MintedId[] }
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
      const minted = Array.isArray(result.body.minted) ? (result.body.minted as MintedId[]) : [];
      return { ok: true, version: this.recordVersion, minted };
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
  async publish(publishedTime?: string): Promise<VerbResult> {
    if (!this.lockState.held) return { status: 423, body: { error: 'Lock not held' } };
    const result = await callObjectVerb(this.getToken, {
      action: 'publish_by_time',
      object_type: this.objectType,
      object_id: this.objectId,
      lock_token: this.lockState.held ? this.lockState.lockToken : '',
      // T9.21 (capability #10): omitted = "now"; an explicit ISO timestamp
      // back/forward-stamps. Scheduling/unpublish stay rejected per OQ-2 —
      // the UI surfaces only what the verb allows.
      ...(publishedTime !== undefined ? { published_time: publishedTime } : {}),
    });
    if (result.status === 200) this.recordVersion = undefined; // publish bumps version; refetch lazily
    return result;
  }

  /** Open review on the current revision under this session's lock. */
  async submitReview(): Promise<VerbResult> {
    if (!this.lockState.held) return { status: 423, body: { error: 'Lock not held' } };
    return callObjectVerb(this.getToken, {
      action: 'submit_review',
      object_type: this.objectType,
      object_id: this.objectId,
      lock_token: this.lockState.held ? this.lockState.lockToken : '',
      requested_publish_action: { published_time: 'immediate' },
    });
  }

  /** Approve the open review through the existing human decision verb. */
  async approveReview(): Promise<VerbResult> {
    return callObjectVerb(this.getToken, {
      action: 'review_decide',
      object_type: this.objectType,
      object_id: this.objectId,
      decision: 'approve',
      publish_action: { published_time: 'immediate' },
    });
  }

  async checkin(): Promise<void> {
    await this.lockManager.checkin();
    this.recordVersion = undefined;
  }
}
