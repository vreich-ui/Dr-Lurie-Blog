/**
 * Function name: Admin_Release
 * Required method: POST
 * Auth: Netlify Identity (admin email allowlist) — the BROWSER path for the
 *       "Release to Production" dashboard button.
 *
 * The human mirror of the release_to_production MCP tool. Both call the SAME
 * shared netlify/lib/production-release.ts, so there is exactly one release
 * path (agent and human) — this file only authenticates the admin and forwards
 * the optional commit / force_build / timeout knobs.
 *
 * The build hook is the only production-build trigger; this endpoint neither
 * reads nor forwards the publish key — it has no article/object write path at
 * all, it only forces a build and reports on the resulting deploy.
 */
import { getAdminStateFromEvent, type LambdaContext } from '../lib/admin-auth.js';
import { resolveRolesFromEvent } from '../lib/request-roles.js';
import { releaseToProduction } from '../lib/production-release.js';

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

const parseOptions = (event: LambdaEvent): { commit?: string; forceBuild?: boolean; timeoutSeconds?: number } => {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    const value = JSON.parse(raw) as Record<string, unknown>;
    return {
      ...(typeof value.commit === 'string' && value.commit.trim() ? { commit: value.commit.trim() } : {}),
      ...(typeof value.force_build === 'boolean' ? { forceBuild: value.force_build } : {}),
      ...(typeof value.timeout_seconds === 'number' ? { timeoutSeconds: value.timeout_seconds } : {}),
    };
  } catch {
    return {};
  }
};

export const handler = async (event: LambdaEvent, context?: LambdaContext) => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const adminState = await getAdminStateFromEvent(event, context);
  if (!adminState.authenticated) return jsonResponse(401, { error: adminState.error ?? 'Unauthorized' });
  // T9.4: gate on resolved roles (users store + bootstrap owners), a superset
  // of the old ADMIN_EMAILS-only check.
  const roles = await resolveRolesFromEvent(event, {
    kind: 'human',
    id: adminState.userId ?? '',
    email: adminState.email ?? '',
  });
  if (!roles.includes('admin')) return jsonResponse(403, { error: 'Admin access required' });

  try {
    const result = await releaseToProduction(parseOptions(event));
    // A configuration gap (no build hook / no deploy API) is a 400 the operator
    // must fix, not a 200 "released:false" the UI might read as "still building".
    const status =
      result.status === 'build_hook_not_configured' || result.status === 'deploy_lookup_not_configured' ? 400 : 200;
    return jsonResponse(status, { result });
  } catch (error) {
    console.error('Admin_Release request failed.', error);
    return jsonResponse(500, { error: 'Production release could not be processed.' });
  }
};
