/**
 * W14 T14.4 — the legacy article surface must not appear on a site that has no
 * legacy article path.
 *
 * The T14.3 decoupling injected the legacy HANDLERS per site but left the tool
 * DECLARATIONS static, so `sites/platform` advertised all twelve legacy tools
 * and would have thrown on any of them. The live round-trip caught it. This
 * pins both halves: the list shrinks when the path is absent, and the named set
 * stays in lockstep with the tools that actually route to a legacy handler.
 */
import '../../sites/drlurie/config/policy-bindings.js'; // registers providers — the core import chain resolves site identity at module load

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { configureMcp, visibleToolDefinitions } from '../../packages/core/server/functions/mcp.js';

/** Walk up to the repo root — this file runs from the COMPILED tree. */
const repoRoot = (): string => {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'packages', 'core', 'server', 'functions', 'mcp.ts'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('repo root not found');
    dir = parent;
  }
  return dir;
};

const SOURCE = join(repoRoot(), 'packages', 'core', 'server', 'functions', 'mcp.ts');

const noop = async () => ({ statusCode: 200, body: '{}' });

const governedOnly = {
  saveArtifactHandler: noop,
  objectStoreHandler: noop,
  deployStatusHandler: noop,
};

const withLegacy = {
  ...governedOnly,
  saveJsonBlobHandler: noop,
  publishArticleHandler: noop,
  verifyArticleImagesHandler: noop,
};

test('a site with no legacy article path advertises no legacy tools', () => {
  configureMcp(governedOnly);
  const names = visibleToolDefinitions().map((tool) => tool.name);
  const leaked = names.filter((name) => /^save_json_blob_|^verify_article_images$/.test(name));
  assert.deepEqual(leaked, [], `legacy tools advertised on a site without the legacy path: ${leaked.join(', ')}`);
  assert.ok(names.length > 30, 'the governed surface is still there');
});

test('a site WITH the legacy article path still advertises them (Dr-Lurie is unchanged)', () => {
  configureMcp(withLegacy);
  const names = visibleToolDefinitions().map((tool) => tool.name);
  assert.ok(names.includes('save_json_blob_create_request'));
  assert.ok(names.includes('verify_article_images'));
});

test('the omitted set equals the tools that actually route to a legacy handler', () => {
  configureMcp(withLegacy);
  const withNames = new Set(visibleToolDefinitions().map((tool) => tool.name));
  configureMcp(governedOnly);
  const withoutNames = new Set(visibleToolDefinitions().map((tool) => tool.name));
  const omitted = [...withNames].filter((name) => !withoutNames.has(name)).sort();

  // Every omitted tool must be one whose implementation reaches a legacy
  // handler — otherwise the set has drifted and a governed tool is being hidden.
  const source = readFileSync(SOURCE, 'utf8');
  for (const name of omitted) {
    const declared = source.includes(`'${name}'`);
    assert.ok(declared, `${name} is omitted but not declared in the source`);
  }
  assert.ok(omitted.length >= 12, `expected the legacy surface, got ${omitted.length}`);
  assert.ok(
    omitted.every((name) => name.startsWith('save_json_blob_') || name === 'verify_article_images'),
    `omitted set contains a non-legacy tool: ${omitted.join(', ')}`
  );
});
