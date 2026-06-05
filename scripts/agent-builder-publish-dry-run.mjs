#!/usr/bin/env node
const DEFAULT_SLUG = 'agent-builder-dry-run';
const DEFAULT_MARKDOWN = `---
publishDate: 2026-05-12T00:00:00.000Z
title: "Agent Builder dry run"
excerpt: "Local verification payload for the Agent Builder publish flow."
tags:
  - "agent-builder"
---

This is a dry-run article body. It is already fully rendered Markdown with frontmatter before it is sent.
`;
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run') || !args.has('--send');
const slug = process.env.AGENT_PUBLISH_SLUG || DEFAULT_SLUG;
const endpointBaseUrl = (process.env.AGENT_PUBLISH_BASE_URL || 'http://localhost:8888').replace(/\/$/, '');
const endpointUrl = `${endpointBaseUrl}/.netlify/functions/publish-article`;
const markdown = process.env.AGENT_PUBLISH_MARKDOWN || DEFAULT_MARKDOWN.replaceAll(DEFAULT_SLUG, slug);
const artifactReferences = process.env.AGENT_PUBLISH_ARTIFACT_REFERENCES
  ? JSON.parse(process.env.AGENT_PUBLISH_ARTIFACT_REFERENCES)
  : [];

const payload = {
  slug,
  articlePath: `src/data/post/${slug}.md`,
  markdown,
  artifactReferences,
  commitMessage: process.env.AGENT_PUBLISH_COMMIT_MESSAGE || `Publish Agent Builder article: ${slug}`,
};

const assertFullyRenderedMarkdown = (value) => {
  if (!value.startsWith('---\n')) {
    throw new Error('AGENT_PUBLISH_MARKDOWN must be fully rendered Markdown with frontmatter before publishing.');
  }

  const frontmatterEnd = value.indexOf('\n---\n', 4);
  if (frontmatterEnd === -1) {
    throw new Error('AGENT_PUBLISH_MARKDOWN frontmatter must close with a second --- delimiter.');
  }
};

const assertArtifactReferences = (value) => {
  if (!Array.isArray(value)) {
    throw new Error('AGENT_PUBLISH_ARTIFACT_REFERENCES must be a JSON array of ArtifactReference objects.');
  }

  value.forEach((reference, index) => {
    const unexpected = Object.keys(reference || {}).filter(
      (key) => !['blobKey', 'sizeBytes', 'sha256', 'contentType', 'createdAtISO', 'metadata'].includes(key)
    );
    if (unexpected.length) {
      throw new Error(`artifactReferences[${index}] contains unexpected keys: ${unexpected.join(', ')}.`);
    }
    if (
      !reference ||
      typeof reference.blobKey !== 'string' ||
      typeof reference.sizeBytes !== 'number' ||
      !/^[a-f0-9]{64}$/i.test(String(reference.sha256 || '')) ||
      typeof reference.contentType !== 'string' ||
      Number.isNaN(Date.parse(String(reference.createdAtISO || '')))
    ) {
      throw new Error(`artifactReferences[${index}] must be a complete ArtifactReference returned by save_artifact.`);
    }
  });
};

const assertExactPayloadShape = (value) => {
  const expectedKeys = ['slug', 'articlePath', 'markdown', 'artifactReferences', 'commitMessage'];
  const actualKeys = Object.keys(value);
  const unexpected = actualKeys.filter((key) => !expectedKeys.includes(key));
  const missing = expectedKeys.filter((key) => !actualKeys.includes(key));

  if (unexpected.length || missing.length) {
    throw new Error(
      `Payload shape mismatch. Missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}.`
    );
  }
};

assertFullyRenderedMarkdown(payload.markdown);
assertArtifactReferences(payload.artifactReferences);
assertExactPayloadShape(payload);

console.info('[agent-builder-publish] Endpoint:', endpointUrl);
console.info('[agent-builder-publish] Article path:', payload.articlePath);
console.info('[agent-builder-publish] Artifact references:', payload.artifactReferences.length);

if (dryRun) {
  console.info('[agent-builder-publish] Dry run only. Re-run with --send to POST this payload.');
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const publishSecret = process.env.PUBLISH_SECRET;
if (!publishSecret) {
  throw new Error('PUBLISH_SECRET is required when using --send. Keep it server-side only.');
}

console.info('[agent-builder-publish] Posting payload to Netlify publish function...');
const response = await fetch(endpointUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-publish-key': publishSecret,
  },
  body: JSON.stringify(payload),
});

const responseText = await response.text();
let responseBody;
try {
  responseBody = responseText ? JSON.parse(responseText) : {};
} catch {
  responseBody = { raw: responseText };
}

if (!response.ok) {
  console.error('[agent-builder-publish] Publish failed', {
    status: response.status,
    statusText: response.statusText,
    articlePath: payload.articlePath,
    artifactReferenceCount: payload.artifactReferences.length,
    response: responseBody,
  });
  process.exit(1);
}

console.info('[agent-builder-publish] Publish succeeded', responseBody);
