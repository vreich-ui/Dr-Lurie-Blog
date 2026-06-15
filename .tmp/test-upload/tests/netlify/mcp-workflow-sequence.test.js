import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import test from 'node:test';
import { handler } from '../../netlify/functions/mcp.js';
import { getContentSourceMarkdown } from '../../src/lib/contentSourceBody.js';
const localBlobRoot = new URL('../../.netlify/local-blobs/workflows/', import.meta.url);
const contentSourceInput = (requestId) => ({
    record_type: 'content_source',
    schema_version: 'content_source.v1',
    content: {
        schema_version: 'content_blocks.v1',
        title: 'MCP workflow smoke test',
    },
    editorial: {
        schema_version: 'editorial.v1',
        draft_markdown: 'MCP workflow smoke test body.',
    },
    publication: {
        schema_version: 'publication.v1',
        publish_payload: {
            slug: 'mcp-workflow-smoke-test',
            title: 'MCP workflow smoke test',
            author: 'Dr. Lurié',
        },
    },
    workflow: {
        schema_version: 'content_workflow.v1',
        workflow_id: requestId,
    },
    versioning: {
        schema_version: 'versioning.v1',
        record_version: 1,
    },
});
const getText = (value) => (typeof value === 'string' ? value.trim() : '');
const slugifyForImportTest = (value) => value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const verifyAdminPublishImportable = (input) => {
    const payload = input.publication?.publish_payload ?? {};
    const title = getText(payload.title) || getText(input.content?.title);
    const slug = getText(payload.slug) || slugifyForImportTest(title);
    const author = getText(payload.author);
    const body = getContentSourceMarkdown(input);
    assert.ok(title, 'admin import requires a title from publication.publish_payload.title or content.title');
    assert.ok(slug, 'admin import requires publication.publish_payload.slug or enough title text to compute one');
    assert.ok(author, 'admin import requires publication.publish_payload.author');
    assert.ok(body, 'admin import requires markdown, content, editorial.draft_markdown, or content.blocks markdown body text');
};
const callTool = async (name, args) => {
    const response = await handler({
        httpMethod: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name, arguments: args },
        }),
    });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.result.isError, undefined, body.result.content?.[0]?.text ?? `${name} returned an MCP error`);
    assert.ok(body.result.structuredContent, `${name} should return structuredContent`);
    return body.result.structuredContent;
};
test('MCP create_request minimum admin-publish draft satisfies admin publish import requirements', async () => {
    process.env.NETLIFY_PUBLISH_SECRET = 'mcp-smoke-secret';
    process.env.PUBLISH_SECRET = 'mcp-smoke-secret';
    process.env.NETLIFY = 'false';
    process.env.NETLIFY_SITE_ID = '';
    await rm(localBlobRoot, { recursive: true, force: true });
    const publishPageSource = await readFile(`${process.cwd()}/src/pages/admin/publish.astro`, 'utf8');
    for (const requiredPath of [
        'publication.publish_payload.title',
        'publication.publish_payload.slug',
        'publication.publish_payload.author',
        'publication.publish_payload.markdown',
        'publication.publish_payload.content',
        'editorial.draft_markdown',
        'content.blocks',
    ]) {
        assert.match(publishPageSource, new RegExp(requiredPath.replaceAll('.', '\\.')));
    }
    const requestId = `mcp-admin-publish-minimum-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const createResult = await callTool('save_json_blob_create_request', {
        request_id: requestId,
        validation_mode: 'admin_publish_draft',
        input: {
            record_type: 'content_source',
            schema_version: 'content_source.v1',
            content: {
                schema_version: 'content_blocks.v1',
                title: 'Minimum Admin Publish Draft',
            },
            editorial: {
                schema_version: 'editorial.v1',
                draft_markdown: 'Minimum body imported from editorial markdown.',
            },
            publication: {
                schema_version: 'publication.v1',
                publish_payload: {
                    slug: 'minimum-admin-publish-draft',
                    title: 'Minimum Admin Publish Draft',
                    author: 'Dr. Lurié',
                },
            },
            workflow: {
                schema_version: 'content_workflow.v1',
                workflow_id: requestId,
                current_agent: 'final_article',
                next_agent: null,
            },
        },
        current_agent: 'final_article',
        next_agent: null,
    });
    const record = createResult.record;
    assert.equal(record.current_stage, 'final_article');
    assert.equal(record.next_agent, null);
    verifyAdminPublishImportable(record.input);
});
test('MCP create_request honors explicit initial current and next agents', async () => {
    process.env.NETLIFY_PUBLISH_SECRET = 'mcp-smoke-secret';
    process.env.PUBLISH_SECRET = 'mcp-smoke-secret';
    process.env.NETLIFY = 'false';
    process.env.NETLIFY_SITE_ID = '';
    await rm(localBlobRoot, { recursive: true, force: true });
    const requestId = `mcp-explicit-routing-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const createResult = await callTool('save_json_blob_create_request', {
        request_id: requestId,
        input: contentSourceInput(requestId),
        current_agent: 'final_article',
        next_agent: null,
    });
    const createdRecord = createResult.record;
    assert.equal(createdRecord.current_stage, 'final_article');
    assert.equal(createdRecord.next_agent, null);
});
test('MCP tools run create → checkout → patch output → mark complete → mark published → checkin', async () => {
    process.env.NETLIFY_PUBLISH_SECRET = 'mcp-smoke-secret';
    process.env.PUBLISH_SECRET = 'mcp-smoke-secret';
    process.env.NETLIFY = 'false';
    process.env.NETLIFY_SITE_ID = '';
    await rm(localBlobRoot, { recursive: true, force: true });
    const requestId = `mcp-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const createResult = await callTool('save_json_blob_create_request', {
        request_id: requestId,
        input: contentSourceInput(requestId),
    });
    const createdRecord = createResult.record;
    assert.equal(createdRecord.request_id, requestId);
    assert.equal(createdRecord.version, 1);
    const checkoutResult = await callTool('save_json_blob_checkout_request', {
        request_id: requestId,
        owner_id: 'mcp-smoke-agent',
        owner_label: 'MCP smoke test agent',
        lease_seconds: 900,
    });
    const checkoutRecord = checkoutResult.record;
    assert.ok(checkoutRecord.lock.token);
    const patchResult = await callTool('save_json_blob_patch_agent_output', {
        request_id: requestId,
        agent_name: 'reader_insight',
        expected_agent_version: 0,
        lock_token: checkoutRecord.lock.token,
        output: { summary: 'Reader insight complete.' },
    });
    const patchedRecord = patchResult.record;
    assert.equal(patchedRecord.version, checkoutRecord.version + 1);
    assert.equal(patchedRecord.agent_outputs.reader_insight.version, 1);
    const completeResult = await callTool('save_json_blob_mark_agent_complete', {
        request_id: requestId,
        agent_name: 'reader_insight',
        expected_record_version: patchedRecord.version,
        lock_token: checkoutRecord.lock.token,
        next_agent: 'research',
        workflow_status: 'in_progress',
    });
    const completedRecord = completeResult.record;
    assert.equal(completedRecord.version, patchedRecord.version + 1);
    assert.equal(completedRecord.next_agent, 'research');
    assert.equal(completedRecord.completed_agents.includes('reader_insight'), true);
    const checkinResult = await callTool('save_json_blob_checkin_request', {
        request_id: requestId,
        lock_token: checkoutRecord.lock.token,
    });
    const checkedInRecord = checkinResult.record;
    assert.equal(checkedInRecord.lock, undefined);
    const finalCheckoutResult = await callTool('save_json_blob_checkout_request', {
        request_id: requestId,
        owner_id: 'mcp-smoke-final-agent',
        owner_label: 'MCP smoke final agent',
    });
    const finalCheckoutRecord = finalCheckoutResult.record;
    const finalOutputResult = await callTool('final_article_update_output', {
        request_id: requestId,
        expected_agent_version: 0,
        lock_token: finalCheckoutRecord.lock.token,
        output: { title: 'MCP smoke final article', body: 'Final article body.' },
    });
    const finalOutputRecord = finalOutputResult.record;
    const finalCompleteResult = await callTool('final_article_mark_complete', {
        request_id: requestId,
        expected_record_version: finalOutputRecord.version,
        lock_token: finalCheckoutRecord.lock.token,
    });
    const finalCompleteRecord = finalCompleteResult.record;
    assert.equal(finalCompleteRecord.current_stage, null);
    assert.equal(finalCompleteRecord.next_agent, null);
    assert.equal(finalCompleteRecord.workflow_status, 'completed');
    assert.equal(finalCompleteRecord.completed_agents.includes('final_article'), true);
    assert.equal(finalCompleteRecord.needs_review, false);
    assert.equal(finalCompleteRecord.last_error, null);
    assert.deepEqual(finalCompleteRecord.agent_outputs.final_article?.output, {
        title: 'MCP smoke final article',
        body: 'Final article body.',
    });
    const publishedResult = await callTool('save_json_blob_mark_published', {
        request_id: requestId,
        expected_record_version: finalCompleteRecord.version,
        lock_token: finalCheckoutRecord.lock.token,
        commit_metadata: {
            commit: 'abc123',
            articlePath: 'src/data/post/mcp-smoke.md',
            deployStatus: 'queued',
        },
    });
    const publishedRecord = publishedResult.record;
    assert.equal(publishedRecord.workflow_status, 'published');
    assert.equal(publishedRecord.current_stage, finalCompleteRecord.current_stage);
    assert.equal(publishedRecord.next_agent, finalCompleteRecord.next_agent);
    assert.deepEqual(publishedRecord.completed_agents, finalCompleteRecord.completed_agents);
    assert.deepEqual(publishedRecord.history.at(-1)?.details?.commit_metadata, {
        commit: 'abc123',
        articlePath: 'src/data/post/mcp-smoke.md',
        deployStatus: 'queued',
    });
    const finalCheckinResult = await callTool('save_json_blob_checkin_request', {
        request_id: requestId,
        lock_token: finalCheckoutRecord.lock.token,
    });
    const finalCheckedInRecord = finalCheckinResult.record;
    assert.equal(finalCheckedInRecord.workflow_status, 'published');
    assert.equal(finalCheckedInRecord.lock, undefined);
    assert.deepEqual(finalCheckedInRecord.completed_agents, finalCompleteRecord.completed_agents);
    const fetchedPublishedResult = await callTool('save_json_blob_get_request', { request_id: requestId });
    const fetchedPublishedRecord = fetchedPublishedResult.record;
    assert.equal(fetchedPublishedRecord.workflow_status, 'published');
    assert.deepEqual(fetchedPublishedRecord.completed_agents, finalCompleteRecord.completed_agents);
});
test('final_article_mark_complete matches generic mark_agent_complete state changes', async () => {
    process.env.NETLIFY_PUBLISH_SECRET = 'mcp-smoke-secret';
    process.env.PUBLISH_SECRET = 'mcp-smoke-secret';
    process.env.NETLIFY = 'false';
    process.env.NETLIFY_SITE_ID = '';
    await rm(localBlobRoot, { recursive: true, force: true });
    const checkoutWorkflow = async (suffix) => {
        const requestId = `mcp-final-equivalence-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await callTool('save_json_blob_create_request', {
            request_id: requestId,
            input: contentSourceInput(requestId),
        });
        const checkoutResult = await callTool('save_json_blob_checkout_request', {
            request_id: requestId,
            owner_id: 'mcp-final-equivalence-agent',
            owner_label: 'MCP final equivalence agent',
            lease_seconds: 900,
        });
        const checkoutRecord = checkoutResult.record;
        const patchResult = await callTool('final_article_update_output', {
            request_id: requestId,
            expected_agent_version: 0,
            lock_token: checkoutRecord.lock.token,
            output: { title: 'Final article parity', body: 'Final article body.' },
        });
        return {
            requestId,
            checkoutRecord,
            patchedRecord: patchResult.record,
        };
    };
    const generic = await checkoutWorkflow('generic');
    const specific = await checkoutWorkflow('specific');
    const explicitFinalCompleteArgs = {
        current_stage: null,
        next_agent: null,
        workflow_status: 'completed',
        needs_review: false,
        last_error: null,
    };
    const genericResult = await callTool('save_json_blob_mark_agent_complete', {
        request_id: generic.requestId,
        agent_name: 'final_article',
        expected_record_version: generic.patchedRecord.version,
        lock_token: generic.checkoutRecord.lock.token,
        ...explicitFinalCompleteArgs,
    });
    const specificResult = await callTool('final_article_mark_complete', {
        request_id: specific.requestId,
        expected_record_version: specific.patchedRecord.version,
        lock_token: specific.checkoutRecord.lock.token,
    });
    const genericIdempotentResult = await callTool('final_article_mark_complete', {
        request_id: generic.requestId,
        agent_name: 'final_article',
        expected_record_version: generic.patchedRecord.version,
        lock_token: generic.checkoutRecord.lock.token,
        ...explicitFinalCompleteArgs,
    });
    const genericRecord = genericResult.record;
    const genericIdempotentRecord = genericIdempotentResult.record;
    const specificRecord = specificResult.record;
    const comparableState = (record, patchedVersion, lockToken) => ({
        version_increment: record.version - patchedVersion,
        workflow_status: record.workflow_status,
        current_stage: record.current_stage,
        next_agent: record.next_agent,
        completed_agents: record.completed_agents,
        failed_agents: record.failed_agents,
        needs_review: record.needs_review,
        last_error: record.last_error,
        final_article_output: record.agent_outputs.final_article?.output,
        final_article_output_version: record.agent_outputs.final_article?.version,
        lock_token_preserved: record.lock?.token === lockToken,
        history_length: record.history.length,
        last_history_action: record.history.at(-1)?.action,
        last_history_agent: record.history.at(-1)?.agent_name,
    });
    assert.deepEqual(genericIdempotentRecord, genericRecord);
    assert.equal(specificRecord.workflow_status, 'completed');
    assert.equal(specificRecord.current_stage, null);
    assert.equal(specificRecord.next_agent, null);
    assert.equal(specificRecord.completed_agents.includes('final_article'), true);
    assert.deepEqual(specificRecord.agent_outputs.final_article?.output, {
        title: 'Final article parity',
        body: 'Final article body.',
    });
    assert.deepEqual(comparableState(genericRecord, generic.patchedRecord.version, generic.checkoutRecord.lock.token), comparableState(specificRecord, specific.patchedRecord.version, specific.checkoutRecord.lock.token));
});
