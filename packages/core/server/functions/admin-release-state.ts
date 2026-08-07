import type { SiteBinding } from '../lib/site-binding.js';
import type { LambdaContext } from '../lib/admin-auth.js';
import { resolveAdminAccessFromEvent } from '../lib/request-roles.js';
import { getSiteObjectsBlobStore } from '../lib/blob-store.js';
import { handleObjectVerb, type ObjectVerbStore } from '../lib/object-verbs.js';
import type { InventoryRow } from '../lib/object-inventory.js';
import {
  fetchRecentDeploys,
  getPublishedProductionDeploy,
  isNetlifyDeployLookupConfigured,
  type DeployReceipt,
} from '../lib/netlify-deploys.js';
import { isCommitAncestorOrEqual } from '../lib/production-release.js';
import { getEditorialDeployStatus, getEditorialObjectState } from '../../lib/admin/editorial-state.js';

type LambdaEvent = {
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
};

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify({ ok: statusCode >= 200 && statusCode < 300, status: statusCode, ...body }),
});

const safeDeploy = (receipt: DeployReceipt | undefined) =>
  receipt
    ? {
        id: receipt.deployId,
        commit: receipt.commit,
        status: receipt.deployStatus,
        started_at: receipt.startedAt,
        finished_at: receipt.finishedAt,
        production_url: receipt.productionUrl,
      }
    : undefined;

const buildHandlerImpl = (_binding: SiteBinding) => async (event: LambdaEvent, context?: LambdaContext) => {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });
  const access = await resolveAdminAccessFromEvent(event, context);
  if (!access.authenticated) return jsonResponse(401, { error: access.error || 'Authentication is required.' });
  if (!access.isAdmin || !access.email) return jsonResponse(403, { error: 'Admin access is required.' });

  try {
    const inventory = await handleObjectVerb(
      (await getSiteObjectsBlobStore(event)) as unknown as ObjectVerbStore,
      { action: 'inventory', status: 'active' },
      { kind: 'human', id: access.userId ?? '', email: access.email },
      { roles: access.roles }
    );
    if (inventory.status !== 200) return jsonResponse(500, { error: 'Publication state could not be loaded.' });
    const rows = (inventory.body.objects ?? []) as InventoryRow[];

    const lookupConfigured = isNetlifyDeployLookupConfigured();
    const [publishedDeploy, recentDeploys] = lookupConfigured
      ? await Promise.all([getPublishedProductionDeploy(), fetchRecentDeploys()])
      : [undefined, [] as DeployReceipt[]];
    const latestProduction = recentDeploys.find((deploy) => !deploy.context || deploy.context === 'production');
    const publishedCommit = publishedDeploy?.commit || undefined;
    const commits = Array.from(
      new Set(rows.map((row) => row.publish_commit).filter((value): value is string => Boolean(value)))
    );
    const includedCommits = publishedCommit
      ? (
          await Promise.all(
            commits.map(async (commit) =>
              commit === publishedCommit || (await isCommitAncestorOrEqual(commit, publishedCommit))
                ? commit
                : undefined
            )
          )
        ).filter((commit): commit is string => Boolean(commit))
      : [];
    const deployState = {
      production_confirmed: Boolean(publishedCommit),
      ...(publishedCommit ? { live_commit: publishedCommit } : {}),
      included_commits: includedCommits,
      status: lookupConfigured ? getEditorialDeployStatus(latestProduction, publishedCommit) : ('unavailable' as const),
    };
    const objects = rows.map((row) => ({
      object_id: row.object_id,
      object_type: row.object_type,
      display_name: row.display_name,
      review_state: row.review_state,
      approval_state: row.approval_state,
      requires_approval: row.requires_approval,
      state: getEditorialObjectState(row, deployState),
    }));

    return jsonResponse(200, {
      deploy: {
        configured: lookupConfigured,
        state: deployState.status,
        production_confirmed: deployState.production_confirmed,
        live_commit: publishedCommit ?? null,
        latest: safeDeploy(latestProduction) ?? null,
        published: safeDeploy(publishedDeploy) ?? null,
      },
      objects,
      waiting_count: objects.filter((object) => object.state === 'published').length,
      pending_approval_count: objects.filter((object) => object.review_state === 'open').length,
    });
  } catch (error) {
    console.error('Failed to load release state.', error);
    return jsonResponse(500, { error: 'Release state could not be loaded.' });
  }
};

export const createHandler = (binding: SiteBinding) => buildHandlerImpl(binding);
