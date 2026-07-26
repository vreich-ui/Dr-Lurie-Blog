import '../../sites/drlurie/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import { releaseToProduction } from '../../packages/core/server/lib/production-release.js';

// The lib composes triggerNetlifyBuild + the GitHub ref API + pollDeployReceipt,
// all of which use the global fetch. Each test stubs global fetch by URL and
// pins exactly the env the code reads, restoring both afterward.

const ENV_KEYS = [
  'NETLIFY_BUILD_HOOK_URL',
  'NETLIFY_SITE_ID',
  'SITE_ID',
  'NETLIFY_AUTH_TOKEN',
  'NETLIFY_BLOBS_TOKEN',
  'GITHUB_CONTENT_TOKEN',
  'GITHUB_REPOSITORY',
  'GITHUB_BRANCH',
  'BRANCH',
] as const;

const withEnv = async (overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => Promise<void>) => {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
  try {
    await fn();
  } finally {
    for (const key of ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

type FetchRoute = (url: string, init?: RequestInit) => Response | undefined;

const withFetch = async (route: FetchRoute, fn: () => Promise<void>) => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const response = route(url, init);
    if (!response) throw new Error(`unexpected fetch: ${url}`);
    return response;
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
};

const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

const CONFIGURED = {
  NETLIFY_BUILD_HOOK_URL: 'https://api.netlify.com/build_hooks/hook123',
  NETLIFY_SITE_ID: 'site-abc',
  NETLIFY_AUTH_TOKEN: 'tok-abc',
  GITHUB_CONTENT_TOKEN: 'gh-tok',
  GITHUB_REPOSITORY: 'drlurie/site',
};

const HEAD_SHA = 'abc123def456';

const routeHappyPath =
  (deployCommit: string, state: string): FetchRoute =>
  (url) => {
    if (url.includes('/build_hooks/')) return new Response('ok', { status: 200 });
    if (url.includes('api.github.com') && url.includes('/git/ref/heads/')) {
      return jsonResponse({ object: { sha: HEAD_SHA } });
    }
    if (url.includes('api.netlify.com') && url.includes('/deploys')) {
      return jsonResponse([{ id: 'd1', state, commit_ref: deployCommit, ssl_url: 'https://drlurie.com' }]);
    }
    return undefined;
  };

// Serves the site object (published_deploy) in addition to the happy-path
// routes. The /deploys check must come first: /sites/{id}/deploys contains both
// substrings.
const routeWithPublished =
  (deployCommit: string, deployState: string, publishedCommit: string): FetchRoute =>
  (url) => {
    if (url.includes('/build_hooks/')) return new Response('ok', { status: 200 });
    if (url.includes('api.github.com') && url.includes('/git/ref/heads/')) {
      return jsonResponse({ object: { sha: HEAD_SHA } });
    }
    if (url.includes('api.netlify.com') && url.includes('/deploys')) {
      return jsonResponse([{ id: 'd1', state: deployState, commit_ref: deployCommit, ssl_url: 'https://drlurie.com' }]);
    }
    if (url.includes('api.netlify.com') && url.includes('/sites/')) {
      return jsonResponse({
        published_deploy: { id: 'pub1', state: 'ready', commit_ref: publishedCommit, ssl_url: 'https://drlurie.com' },
      });
    }
    return undefined;
  };

test('published deploy matching the target commit confirms the release', async () => {
  await withEnv(CONFIGURED, async () => {
    await withFetch(routeWithPublished(HEAD_SHA, 'ready', HEAD_SHA), async () => {
      const result = await releaseToProduction({ intervalSeconds: 1, timeoutSeconds: 5 });
      assert.equal(result.status, 'released');
      assert.equal(result.released, true);
      assert.equal(result.productionConfirmed, true);
      assert.equal(result.publishedDeploy?.deployId, 'pub1');
    });
  });
});

test('ready build with production serving an older commit reports build_ready_not_published, not released', async () => {
  await withEnv(CONFIGURED, async () => {
    await withFetch(routeWithPublished(HEAD_SHA, 'ready', 'oldsha999'), async () => {
      const result = await releaseToProduction({ intervalSeconds: 1, timeoutSeconds: 5 });
      assert.equal(result.status, 'build_ready_not_published');
      assert.equal(result.released, false);
      assert.equal(result.productionConfirmed, false);
      assert.equal(result.productionReflectsCommit, true, 'the ready-by-commit signal itself is preserved');
      assert.equal(result.publishedDeploy?.commit, 'oldsha999');
      assert.match(result.reason, /Auto Publishing/);
    });
  });
});

test('a published deploy on the target commit wins even when the receipt poll never sees ready', async () => {
  await withEnv(CONFIGURED, async () => {
    await withFetch(routeWithPublished('othersha', 'building', HEAD_SHA), async () => {
      const result = await releaseToProduction({ intervalSeconds: 1, timeoutSeconds: 1 });
      assert.equal(result.released, true);
      assert.equal(result.productionConfirmed, true);
      assert.equal(result.status, 'released');
    });
  });
});

test('forceBuild without a configured build hook refuses rather than reporting a stale deploy', async () => {
  await withEnv({ NETLIFY_SITE_ID: 'site-abc', NETLIFY_AUTH_TOKEN: 'tok-abc' }, async () => {
    const result = await releaseToProduction({ forceBuild: true });
    assert.equal(result.released, false);
    assert.equal(result.status, 'build_hook_not_configured');
    assert.equal(result.buildTriggered, false);
  });
});

test('full path: forces a build, resolves HEAD, waits, and confirms production reflects the commit', async () => {
  await withEnv(CONFIGURED, async () => {
    await withFetch(routeHappyPath(HEAD_SHA, 'ready'), async () => {
      const result = await releaseToProduction({ intervalSeconds: 1, timeoutSeconds: 5 });
      assert.equal(result.status, 'released');
      assert.equal(result.released, true);
      assert.equal(result.buildTriggered, true);
      assert.equal(result.targetCommit, HEAD_SHA);
      assert.equal(result.productionReflectsCommit, true);
      assert.equal(result.deploy?.deployStatus, 'ready');
      assert.equal(result.productionUrl, 'https://drlurie.com');
      // The site (published_deploy) endpoint is not routed here, so the
      // published-deploy signal degrades to unavailable: still released by
      // ready-by-commit, but never independently confirmed.
      assert.equal(result.productionConfirmed, false);
    });
  });
});

test('an explicit commit with forceBuild:false verifies without POSTing the build hook', async () => {
  await withEnv(CONFIGURED, async () => {
    let hookPosted = false;
    const route: FetchRoute = (url) => {
      if (url.includes('/build_hooks/')) {
        hookPosted = true;
        return new Response('ok', { status: 200 });
      }
      if (url.includes('api.netlify.com') && url.includes('/deploys')) {
        return jsonResponse([{ id: 'd1', state: 'ready', commit_ref: 'deadbeef', ssl_url: 'https://drlurie.com' }]);
      }
      return undefined;
    };
    await withFetch(route, async () => {
      const result = await releaseToProduction({ commit: 'deadbeef', forceBuild: false, intervalSeconds: 1 });
      assert.equal(hookPosted, false, 'forceBuild:false must not trigger a build');
      assert.equal(result.released, true);
      assert.equal(result.targetCommit, 'deadbeef');
    });
  });
});

test('a deploy that never reaches ready reports build_not_confirmed_live, not released', async () => {
  await withEnv(CONFIGURED, async () => {
    await withFetch(routeHappyPath('othersha', 'building'), async () => {
      // The ready deploy is for a different commit / still building, so the poll
      // times out without confirming HEAD is live.
      const result = await releaseToProduction({ intervalSeconds: 1, timeoutSeconds: 1 });
      assert.equal(result.released, false);
      assert.equal(result.status, 'build_not_confirmed_live');
      assert.equal(result.targetCommit, HEAD_SHA);
    });
  });
});

test('with the deploy API unconfigured, a triggered build cannot be verified live', async () => {
  await withEnv(
    {
      NETLIFY_BUILD_HOOK_URL: CONFIGURED.NETLIFY_BUILD_HOOK_URL,
      ...{ GITHUB_CONTENT_TOKEN: 'gh-tok', GITHUB_REPOSITORY: 'drlurie/site' },
    },
    async () => {
      const route: FetchRoute = (url) => {
        if (url.includes('/build_hooks/')) return new Response('ok', { status: 200 });
        if (url.includes('api.github.com')) return jsonResponse({ object: { sha: HEAD_SHA } });
        return undefined;
      };
      await withFetch(route, async () => {
        const result = await releaseToProduction({});
        assert.equal(result.status, 'deploy_lookup_not_configured');
        assert.equal(result.released, false);
        assert.equal(result.buildTriggered, true);
      });
    }
  );
});
