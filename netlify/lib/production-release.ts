/**
 * Production release + verification (Gap 2).
 *
 * Deploy reality (confirmed with the site owner, 2026-07-07): pushing to the
 * content branch auto-builds and auto-deploys on Netlify — a CMS object or
 * article publish already triggers a production deploy by committing to main.
 * So this is NOT a "promotion gate" that makes an otherwise-dark commit live;
 * publishing is what makes it live. What this module adds is the honest
 * other half of that story: a publish returns as soon as the COMMIT lands,
 * but the DEPLOY is asynchronous, so "committed" != "live" for the ~30-120s
 * the build runs. releaseToProduction lets an agent (or the admin dashboard)
 * force a fresh production build and then BLOCK until it can prove the live
 * production deploy reflects a specific commit.
 *
 * The build hook is the only thing here that can start a production build
 * (the project invariant): forceBuild POSTs `NETLIFY_BUILD_HOOK_URL` through
 * the existing triggerNetlifyBuild — there is deliberately no second env var
 * and no other trigger path. Everything else is read-only: resolve the target
 * commit (the content branch HEAD via the GitHub ref API, the same
 * GITHUB_CONTENT_TOKEN/GITHUB_REPOSITORY/GITHUB_BRANCH contract the object
 * committer uses), then poll Netlify deploy receipts until the deploy for that
 * commit is terminal, and report whether production actually reflects it.
 *
 * Shared by BOTH surfaces so there is one release path, never two: the
 * `release_to_production` MCP tool (agents) and the admin dashboard
 * "Release to Production" button (humans) both call this function.
 */
import {
  isNetlifyBuildHookConfigured,
  isNetlifyDeployLookupConfigured,
  pollDeployReceipt,
  triggerNetlifyBuild,
  type DeployReceipt,
} from './netlify-deploys.js';

const GITHUB_API_ROOT = 'https://api.github.com';

export type ReleaseToProductionOptions = {
  /** Commit the live deploy must reflect. Defaults to the content branch HEAD. */
  commit?: string;
  /** POST the build hook to force a fresh production build first. Default true. */
  forceBuild?: boolean;
  timeoutSeconds?: number;
  intervalSeconds?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

export type ReleaseToProductionResult = {
  /** True only when a terminal, ready production deploy reflects the target commit. */
  released: boolean;
  /** Machine-readable outcome for callers that branch on it. */
  status:
    | 'released'
    | 'build_not_confirmed_live'
    | 'commit_unresolved'
    | 'build_hook_not_configured'
    | 'deploy_lookup_not_configured';
  reason: string;
  targetCommit: string;
  buildTriggered: boolean;
  triggeredAt?: string;
  /** Whether the ready deploy's commit matches the resolved target commit. */
  productionReflectsCommit: boolean;
  deploy?: DeployReceipt;
  productionUrl?: string;
};

const resolveGitHubConfig = () => {
  const token = process.env.GITHUB_CONTENT_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const branch = process.env.GITHUB_BRANCH ?? process.env.BRANCH ?? 'main';
  return { token, repo, branch };
};

/**
 * The content branch HEAD sha via the GitHub ref API — the same repo/branch
 * the object committer PATCHes, so "latest commit" here is exactly what a
 * publish just pushed. Returns undefined when GitHub is not configured or the
 * ref cannot be read (the caller degrades to "commit unresolved").
 */
export const resolveBranchHeadCommit = async (fetchImpl: typeof fetch = fetch): Promise<string | undefined> => {
  const { token, repo, branch } = resolveGitHubConfig();
  if (!token || !repo) return undefined;

  try {
    const response = await fetchImpl(`${GITHUB_API_ROOT}/repos/${repo}/git/ref/heads/${branch}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'dr-lurie-production-release',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { object?: { sha?: unknown } };
    const sha = body.object?.sha;
    return typeof sha === 'string' && sha.trim() ? sha.trim() : undefined;
  } catch {
    return undefined;
  }
};

export const releaseToProduction = async (
  options: ReleaseToProductionOptions = {}
): Promise<ReleaseToProductionResult> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const forceBuild = options.forceBuild ?? true;

  // The build hook is the ONLY sanctioned production-build trigger. If a
  // forced build is requested but no hook is configured, refuse rather than
  // silently skipping it and reporting a stale deploy as "released".
  if (forceBuild && !isNetlifyBuildHookConfigured()) {
    return {
      released: false,
      status: 'build_hook_not_configured',
      reason:
        'Cannot force a production build: NETLIFY_BUILD_HOOK_URL is not configured. The build hook is the only allowed production-build trigger (operator-level setup).',
      targetCommit: '',
      buildTriggered: false,
      productionReflectsCommit: false,
    };
  }

  const targetCommit = options.commit?.trim() || (await resolveBranchHeadCommit(fetchImpl));
  if (!targetCommit) {
    return {
      released: false,
      status: 'commit_unresolved',
      reason:
        'Could not resolve the target commit: pass an explicit commit, or configure GITHUB_CONTENT_TOKEN and GITHUB_REPOSITORY so the branch HEAD can be read.',
      targetCommit: '',
      buildTriggered: false,
      productionReflectsCommit: false,
    };
  }

  let buildTriggered = false;
  let triggeredAt: string | undefined;
  if (forceBuild) {
    const trigger = await triggerNetlifyBuild();
    buildTriggered = true;
    triggeredAt = trigger.triggeredAt;
  }

  // Verification needs the Netlify deploy API. Without it we can at most report
  // that a build was triggered — never that production is confirmed live.
  if (!isNetlifyDeployLookupConfigured()) {
    return {
      released: false,
      status: 'deploy_lookup_not_configured',
      reason:
        'A production build was triggered but go-live cannot be verified: Netlify deploy lookup (NETLIFY_SITE_ID + token) is not configured.',
      targetCommit,
      buildTriggered,
      triggeredAt,
      productionReflectsCommit: false,
    };
  }

  const deploy = await pollDeployReceipt({
    commit: targetCommit,
    timeoutSeconds: options.timeoutSeconds,
    intervalSeconds: options.intervalSeconds,
  });
  const productionReflectsCommit = deploy.deployStatus === 'ready' && deploy.commit === targetCommit;

  return {
    released: productionReflectsCommit,
    status: productionReflectsCommit ? 'released' : 'build_not_confirmed_live',
    reason: productionReflectsCommit
      ? `Production is live on commit ${targetCommit}.`
      : `The production deploy for commit ${targetCommit} did not reach a ready state within the wait budget (deploy status: ${deploy.deployStatus}). Re-check deploy_status; the build may still be in progress.`,
    targetCommit,
    buildTriggered,
    triggeredAt,
    productionReflectsCommit,
    deploy,
    productionUrl: deploy.productionUrl || undefined,
  };
};
