import assert from 'node:assert/strict';
import test from 'node:test';
import { handler } from '../../netlify/functions/run-publisher-agent.js';
const publishSecret = 'publisher-agent-artifact-test-secret';
test('run-publisher-agent fails fast when inline image media cannot be uploaded without a requestId', async () => {
    process.env.PUBLISH_SECRET = publishSecret;
    process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.NETLIFY_PUBLISH_ENDPOINT = 'https://example.com/.netlify/functions/publish-article';
    const response = await handler({
        httpMethod: 'POST',
        headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
        body: JSON.stringify({
            slug: 'inline-image-rejected',
            title: 'Inline Image Rejected',
            markdown: '# Inline image rejected',
            images: [{ repoPath: 'src/assets/images/uploads/inline-image-rejected/generated.png', base64: 'aW1hZ2U=' }],
        }),
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 400, response.body);
    assert.match(body.error, /Artifact upload failed integrity verification/);
    assert.match(body.error, /requestId is required/);
});
test('run-publisher-agent rejects malformed artifactReferences before publishing', async () => {
    process.env.PUBLISH_SECRET = publishSecret;
    process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.NETLIFY_PUBLISH_ENDPOINT = 'https://example.com/.netlify/functions/publish-article';
    const response = await handler({
        httpMethod: 'POST',
        headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
        body: JSON.stringify({
            slug: 'malformed-artifact-reference',
            title: 'Malformed Artifact Reference',
            markdown: '# Malformed artifact reference',
            artifactReferences: [{ blobKey: 'image/request/invented.png', sha256: 'not-a-sha' }],
        }),
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 400, response.body);
    assert.match(body.error, /not a valid ArtifactReference/);
});
