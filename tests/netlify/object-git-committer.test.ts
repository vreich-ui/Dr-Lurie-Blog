import '../../src/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  commitMaterializedFiles,
  ObjectGitCommitError,
  type CommitMaterializedFilesInput,
} from '../../packages/core/server/lib/object-git-committer.js';

const FILES = [
  { path: 'src/data/site/navigation/nav_footer.json', content: '{"role":"footer"}\n' },
  { path: 'src/data/site/site.json', content: '{"name":"Dr. Lurié"}\n' },
];

const sha1 = (value: string) => createHash('sha1').update(value).digest('hex');
const jsonResponse = (value: unknown) =>
  new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });

type RecordedCall = { method: string; path: string; body?: Record<string, unknown> };
type RefPatchOutcome = 'ok' | { status: number; body: string; nextHead?: { sha: string; treeSha: string } };

/**
 * Content-addressed mock of the five Git Data API endpoints the committer
 * uses. `refPatchOutcomes` scripts each successive PATCH of the branch ref;
 * a non-fast-forward outcome may advance head, simulating the article
 * publish stream landing a commit mid-flight (OQ-13).
 */
const createGitHubApiMock = (options: { refPatchOutcomes?: RefPatchOutcome[]; fixedTreeSha?: string } = {}) => {
  const calls: RecordedCall[] = [];
  let head = { sha: 'head0', treeSha: 'tree0' };
  const commitTrees = new Map<string, string>([[head.sha, head.treeSha]]);
  const patchOutcomes = [...(options.refPatchOutcomes ?? ['ok' as const])];
  let commitCounter = 0;

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ method, path: url.pathname, body });

    if (method === 'GET' && url.pathname.includes('/git/ref/heads/')) {
      return jsonResponse({ object: { sha: head.sha } });
    }
    if (method === 'GET' && url.pathname.includes('/git/commits/')) {
      const sha = url.pathname.split('/').pop() as string;
      return jsonResponse({ tree: { sha: commitTrees.get(sha) ?? `tree-of-${sha}` } });
    }
    if (method === 'POST' && url.pathname.endsWith('/git/blobs')) {
      return jsonResponse({ sha: sha1(String(body?.content)) });
    }
    if (method === 'POST' && url.pathname.endsWith('/git/trees')) {
      return jsonResponse({ sha: options.fixedTreeSha ?? sha1(JSON.stringify(body)) });
    }
    if (method === 'POST' && url.pathname.endsWith('/git/commits')) {
      commitCounter += 1;
      const sha = `commit${commitCounter}`;
      commitTrees.set(sha, String(body?.tree));
      return jsonResponse({ sha });
    }
    if (method === 'PATCH' && url.pathname.includes('/git/refs/heads/')) {
      const outcome = patchOutcomes.length ? (patchOutcomes.shift() as RefPatchOutcome) : 'ok';
      if (outcome === 'ok') {
        head = { sha: String(body?.sha), treeSha: commitTrees.get(String(body?.sha)) ?? '' };
        return jsonResponse({ object: { sha: head.sha } });
      }
      if (outcome.nextHead) {
        head = outcome.nextHead;
        commitTrees.set(outcome.nextHead.sha, outcome.nextHead.treeSha);
      }
      return new Response(outcome.body, { status: outcome.status });
    }
    return new Response(`unexpected ${method} ${url.pathname}`, { status: 500 });
  }) as typeof fetch;

  return { fetchImpl, calls };
};

const ENV_KEYS = ['GITHUB_CONTENT_TOKEN', 'GITHUB_REPOSITORY', 'GITHUB_BRANCH', 'BRANCH'] as const;

const withGitHubEnv = async (fn: () => Promise<void>, overrides: Record<string, string | undefined> = {}) => {
  const saved = ENV_KEYS.map((key) => [key, process.env[key]] as const);
  process.env.GITHUB_CONTENT_TOKEN = 'test-token';
  process.env.GITHUB_REPOSITORY = 'vreich-ui/dr-lurie-blog';
  delete process.env.GITHUB_BRANCH;
  delete process.env.BRANCH;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

const run = (mock: ReturnType<typeof createGitHubApiMock>, extra: Partial<CommitMaterializedFilesInput> = {}) =>
  commitMaterializedFiles({
    files: FILES,
    message: 'Publish navigation: nav_footer',
    fetchImpl: mock.fetchImpl,
    sleep: async () => {},
    ...extra,
  });

test('commits materialized files: blobs → tree on base → commit → ref, force:false', async () => {
  await withGitHubEnv(async () => {
    const mock = createGitHubApiMock();
    const result = await run(mock);

    assert.deepEqual(
      { branch: result.branch, commitSha: result.commitSha, noOp: result.noOp, attempts: result.attempts },
      { branch: 'main', commitSha: 'commit1', noOp: false, attempts: 1 }
    );

    const treeCall = mock.calls.find((call) => call.method === 'POST' && call.path.endsWith('/git/trees'));
    assert.equal(treeCall?.body?.base_tree, 'tree0');
    assert.deepEqual(treeCall?.body?.tree, [
      { path: FILES[0].path, mode: '100644', type: 'blob', sha: sha1(FILES[0].content) },
      { path: FILES[1].path, mode: '100644', type: 'blob', sha: sha1(FILES[1].content) },
    ]);

    const commitCall = mock.calls.find((call) => call.method === 'POST' && call.path.endsWith('/git/commits'));
    assert.deepEqual(commitCall?.body?.parents, ['head0']);
    assert.equal(commitCall?.body?.message, 'Publish navigation: nav_footer');

    const patchCall = mock.calls.find((call) => call.method === 'PATCH');
    assert.equal(patchCall?.path, '/repos/vreich-ui/dr-lurie-blog/git/refs/heads/main');
    assert.deepEqual(patchCall?.body, { force: false, sha: 'commit1' });
  });
});

test('non-fast-forward rejection: re-fetches head, rebuilds tree on the new base, retries, succeeds', async () => {
  await withGitHubEnv(async () => {
    // The scripted 422 also moves head — the article stream "won the race".
    const mock = createGitHubApiMock({
      refPatchOutcomes: [
        {
          status: 422,
          body: '{"message":"Update is not a fast forward"}',
          nextHead: { sha: 'headArticle', treeSha: 'treeArticle' },
        },
        'ok',
      ],
    });
    const sleeps: number[] = [];
    const result = await run(mock, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      backoffMs: (attempt) => attempt * 7,
    });

    assert.equal(result.attempts, 2);
    assert.equal(result.commitSha, 'commit2');
    assert.equal(result.noOp, false);
    assert.deepEqual(sleeps, [7]);

    const refGets = mock.calls.filter((call) => call.method === 'GET' && call.path.includes('/git/ref/heads/'));
    assert.equal(refGets.length, 2, 'head must be re-fetched for the retry');

    const treePosts = mock.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/git/trees'));
    assert.equal(treePosts.length, 2);
    assert.equal(treePosts[0].body?.base_tree, 'tree0');
    assert.equal(treePosts[1].body?.base_tree, 'treeArticle', 'retry must rebuild the tree against the new head');
    // Same content → identical blob shas in both trees (T1.1 determinism → idempotent retry).
    assert.deepEqual(treePosts[1].body?.tree, treePosts[0].body?.tree);

    const blobPosts = mock.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/git/blobs'));
    assert.equal(blobPosts.length, FILES.length, 'blobs are content-addressed and not re-created per retry');

    const retryCommit = mock.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/git/commits'))[1];
    assert.deepEqual(retryCommit.body?.parents, ['headArticle'], 'retry commit must parent on the new head');
  });
});

test('retries are capped and exhaustion fails loudly, never silently or unbounded', async () => {
  await withGitHubEnv(async () => {
    const nonFastForward: RefPatchOutcome = { status: 422, body: 'Update is not a fast forward' };
    const mock = createGitHubApiMock({
      refPatchOutcomes: [nonFastForward, nonFastForward, nonFastForward, nonFastForward, nonFastForward],
    });
    const sleeps: number[] = [];

    await assert.rejects(
      run(mock, {
        maxAttempts: 3,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof ObjectGitCommitError);
        assert.equal(error.code, 'non_fast_forward_exhausted');
        assert.equal(error.statusCode, 409);
        assert.match(error.message, /3 attempts/);
        assert.match(error.message, /NOT committed/);
        return true;
      }
    );

    const patches = mock.calls.filter((call) => call.method === 'PATCH');
    assert.equal(patches.length, 3, 'exactly maxAttempts ref updates, no unbounded loop');
    assert.equal(sleeps.length, 2, 'no backoff sleep after the final attempt');
  });
});

test('a non-retryable ref failure propagates immediately without retry', async () => {
  await withGitHubEnv(async () => {
    const mock = createGitHubApiMock({ refPatchOutcomes: [{ status: 401, body: 'Bad credentials' }] });
    const sleeps: number[] = [];

    await assert.rejects(
      run(mock, {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof ObjectGitCommitError);
        assert.equal(error.code, 'github_api_error');
        assert.equal(error.statusCode, 403);
        return true;
      }
    );

    assert.equal(mock.calls.filter((call) => call.method === 'PATCH').length, 1);
    assert.equal(sleeps.length, 0);
  });
});

test('content already at head short-circuits to a no-op instead of an empty duplicate commit', async () => {
  await withGitHubEnv(async () => {
    // Tree built on base resolves to the base tree itself: nothing changed.
    const mock = createGitHubApiMock({ fixedTreeSha: 'tree0' });
    const result = await run(mock);

    assert.deepEqual(
      { noOp: result.noOp, commitSha: result.commitSha, attempts: result.attempts },
      { noOp: true, commitSha: 'head0', attempts: 1 }
    );
    assert.equal(mock.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/git/commits')).length, 0);
    assert.equal(mock.calls.filter((call) => call.method === 'PATCH').length, 0);
  });
});

test('invalid input and missing configuration fail loudly before any API call', async () => {
  await withGitHubEnv(async () => {
    const mock = createGitHubApiMock();

    await assert.rejects(run(mock, { files: [] }), (error: unknown) => {
      assert.ok(error instanceof ObjectGitCommitError);
      assert.equal(error.code, 'invalid_input');
      return true;
    });
    await assert.rejects(run(mock, { files: [FILES[0], FILES[0]] }), /duplicate paths/);
    await assert.rejects(run(mock, { message: '  ' }), /commit message/);
    assert.equal(mock.calls.length, 0);
  });

  await withGitHubEnv(
    async () => {
      const mock = createGitHubApiMock();
      await assert.rejects(run(mock), (error: unknown) => {
        assert.ok(error instanceof ObjectGitCommitError);
        assert.equal(error.code, 'not_configured');
        return true;
      });
      assert.equal(mock.calls.length, 0);
    },
    { GITHUB_CONTENT_TOKEN: undefined }
  );
});

test('GITHUB_BRANCH overrides the default branch in ref paths', async () => {
  await withGitHubEnv(
    async () => {
      const mock = createGitHubApiMock();
      const result = await run(mock);

      assert.equal(result.branch, 'staging');
      const patchCall = mock.calls.find((call) => call.method === 'PATCH');
      assert.equal(patchCall?.path, '/repos/vreich-ui/dr-lurie-blog/git/refs/heads/staging');
    },
    { GITHUB_BRANCH: 'staging' }
  );
});

// ─── OQ-12 isolation: zero import edges between the two commit streams ──────

const findRepoRoot = () => {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(dir, 'packages/core/server/lib/object-git-committer.ts'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the repo root from ' + process.cwd());
};

const importSpecifiers = (source: string): string[] => [
  ...[...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]),
  ...[...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]),
  ...[...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]),
];

test('object committer and article publisher share zero import edges (OQ-12)', () => {
  const root = findRepoRoot();
  const committerSource = readFileSync(path.join(root, 'packages/core/server/lib/object-git-committer.ts'), 'utf-8');
  const articleSource = readFileSync(path.join(root, 'netlify/functions/publish-article.ts'), 'utf-8');

  const committerImports = importSpecifiers(committerSource);
  assert.equal(
    committerImports.some((specifier) => /publish-article/.test(specifier)),
    false,
    'object-git-committer.ts must not import from publish-article.ts'
  );
  assert.equal(
    committerImports.some((specifier) => /\/functions\//.test(specifier)),
    false,
    'object-git-committer.ts must not import from netlify/functions at all'
  );
  assert.equal(
    importSpecifiers(articleSource).some((specifier) => /object-git-committer/.test(specifier)),
    false,
    'publish-article.ts must not import the object committer'
  );
});
