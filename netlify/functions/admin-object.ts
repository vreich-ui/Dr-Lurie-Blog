/**
 * Function name: Admin_Object
 * Required method: POST
 * Auth: Netlify Identity (admin email allowlist) — the BROWSER MIRROR of the
 *       object verbs (T0.8).
 *
 * Same verb surface and same shared core (netlify/lib/object-verbs.ts) as the
 * publish-key entry point (object-store.ts) — the only difference is that this
 * path authenticates a human via Netlify Identity and attributes writes to a
 * human Principal.
 *
 * SECURITY INVARIANT (A§1.2): the browser path must never see the publish key.
 * This file therefore does not import, read, or forward `PUBLISH_SECRET` /
 * `NETLIFY_PUBLISH_SECRET` or the `x-publish-key` header in any form — it has
 * no code path that touches the shared secret. Enforced by a dedicated test.
 */
import { getAdminStateFromEvent, type LambdaContext } from '../lib/admin-auth.js';
import { getSiteObjectsBlobStore } from '../lib/blob-store.js';
import { handleObjectVerb, objectVerbRequestSchema, type ObjectVerbStore } from '../lib/object-verbs.js';
import { buildStoreValidationContext } from '../lib/object-validation-context.js';
import type { ObjectType } from '../../src/schema/object-record-v1.js';
import type { Principal } from '../../src/schema/object-record-v1.js';

type LambdaEvent = {
  httpMethod?: string;
  body?: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
};

const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const jsonResponse = (status: number, body: Record<string, unknown>) => ({
  statusCode: status,
  headers: jsonHeaders,
  body: JSON.stringify({ ok: status >= 200 && status < 300, status, ...body }),
});

const safeJsonParse = (event: LambdaEvent): { ok: true; value: unknown } | { ok: false } => {
  if (!event.body) return { ok: false };
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false };
  }
};

export const handler = async (event: LambdaEvent, context?: LambdaContext) => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const adminState = await getAdminStateFromEvent(event, context);
  if (!adminState.authenticated) return jsonResponse(401, { error: adminState.error ?? 'Unauthorized' });
  if (!adminState.isAdmin) return jsonResponse(403, { error: 'Admin access required' });

  const parsed = safeJsonParse(event);
  if (!parsed.ok) return jsonResponse(400, { error: 'Invalid request body.' });

  const request = objectVerbRequestSchema.safeParse(parsed.value);
  if (!request.success) return jsonResponse(400, { error: 'Invalid request fields.', issues: request.error.issues });

  const principal: Principal = { kind: 'human', id: adminState.userId ?? '', email: adminState.email ?? '' };

  try {
    const store = (await getSiteObjectsBlobStore(event)) as unknown as ObjectVerbStore;
    // Same live validation context as the publish-key path (object-store.ts):
    // the browser admin path enforces the identical structural rules.
    const requestData = request.data as {
      object_id?: string;
      object_type?: ObjectType;
      target?: { kind?: string; page_id?: string };
    };
    // instantiate_section (W8.2) validates the TARGET page under its own id —
    // without the self ref, route uniqueness would flag the page's own route.
    const targetPageId = requestData.target?.kind === 'page' ? requestData.target.page_id : undefined;
    const validationContext = await buildStoreValidationContext(store, {
      selfObjectId: requestData.object_id ?? targetPageId,
      selfObjectType: requestData.object_type ?? (targetPageId ? 'page' : undefined),
    });
    const result = await handleObjectVerb(store, request.data, principal, { validationContext });
    return jsonResponse(result.status, result.body);
  } catch (error) {
    console.error('Admin_Object request failed.', error);
    return jsonResponse(500, { action: request.data.action, error: 'Object request could not be processed.' });
  }
};
