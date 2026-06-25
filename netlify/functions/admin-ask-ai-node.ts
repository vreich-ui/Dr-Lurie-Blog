/**
 * Clerk-authenticated "Ask AI" suggestion endpoint.
 * Read-only with respect to Netlify Blobs – does not acquire a lock,
 * does not write back. Returns a suggestion the human can Accept or Discard.
 *
 * POST body: { requestId, nodeId, selectedText?, instruction }
 * Response:  { suggestion: { updatedPublicFields } }
 *
 * Requires ANTHROPIC_API_KEY in the Netlify environment.
 * Model: claude-sonnet-4-6 (override via ANTHROPIC_MODEL env var).
 */
import { z } from 'zod';

import { getAdminStateFromEvent } from '../lib/admin-auth.js';
import { getWorkflowBlobStore } from '../lib/blob-store.js';
import type { ArticleBodyNode, ArticleBodyV1 } from '../../src/schema/article-content-v1.js';
import type { WorkflowRecord } from '../../src/schema/schema-v1.js';

const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const bodySchema = z
  .object({
    requestId: z.string().min(1),
    nodeId: z.string().regex(/^n_[a-zA-Z0-9]+$/),
    selectedText: z.string().max(4000).optional(),
    instruction: z.string().min(1).max(2000),
  })
  .strict();

type LambdaEvent = {
  blobs?: string;
  body?: string | null;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  isBase64Encoded?: boolean;
};

type AnthropicMessage = { role: 'user' | 'assistant'; content: string };

type AnthropicToolInput = {
  eyebrow?: string;
  title?: string;
  body?: string;
  items?: string[];
  ctaText?: string;
  ctaLink?: string;
  label?: string;
};

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify({ ok: statusCode >= 200 && statusCode < 300, status: statusCode, ...body }),
});

const recordKey = (requestId: string) => `workflows/by-id/${requestId}.json`;

// Returns up to ~300 chars of public text for a node (for context assembly)
const nodeContextSnippet = (node: ArticleBodyNode): string => {
  const parts: string[] = [];
  if (node.public.eyebrow) parts.push(node.public.eyebrow);
  if (node.public.title) parts.push(node.public.title);
  if (node.public.body) parts.push(node.public.body.slice(0, 200));
  if (node.public.items?.length) parts.push(node.public.items.slice(0, 3).join(' · '));
  if (node.public.ctaText) parts.push(`[CTA: ${node.public.ctaText}]`);
  return parts.join(' — ').slice(0, 300);
};

const buildContext = (body: ArticleBodyV1, targetNodeId: string, articleTitle: string): string => {
  const nodes = body.nodes.filter((n) => !n.visibility || n.visibility === 'public');
  const targetIndex = nodes.findIndex((n) => n.id === targetNodeId);

  const prevSnippets = nodes
    .slice(Math.max(0, targetIndex - 2), targetIndex)
    .map((n) => `[PRECEDING] ${nodeContextSnippet(n)}`)
    .join('\n');

  const nextSnippets = nodes
    .slice(targetIndex + 1, targetIndex + 3)
    .map((n) => `[FOLLOWING] ${nodeContextSnippet(n)}`)
    .join('\n');

  return [articleTitle ? `Article: "${articleTitle}"` : '', prevSnippets, nextSnippets]
    .filter(Boolean)
    .join('\n');
};

const callAnthropic = async (messages: AnthropicMessage[], apiKey: string, model: string): Promise<unknown> => {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      tools: [
        {
          name: 'update_node_content',
          description:
            'Return the updated public fields for the article node. Only include fields that should change. Preserve all fields not mentioned in the instruction.',
          input_schema: {
            type: 'object',
            properties: {
              eyebrow: { type: 'string', description: 'Short eyebrow/kicker text above the title' },
              title: { type: 'string', description: 'Section heading' },
              body: { type: 'string', description: 'Main body text (markdown allowed)' },
              items: { type: 'array', items: { type: 'string' }, description: 'Bullet list items' },
              ctaText: { type: 'string', description: 'Call-to-action button label' },
              ctaLink: { type: 'string', description: 'Call-to-action URL' },
              label: { type: 'string', description: 'Short label text' },
            },
            additionalProperties: false,
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'update_node_content' },
      messages,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Anthropic API ${response.status}: ${text.slice(0, 200)}`);
  }

  return response.json();
};

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const adminState = await getAdminStateFromEvent(event);
  if (!adminState.authenticated) return jsonResponse(401, { error: adminState.error ?? 'Unauthorized' });
  if (!adminState.isAdmin) return jsonResponse(403, { error: 'Admin access required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonResponse(500, { error: 'ANTHROPIC_API_KEY is not configured' });

  const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

  let rawBody: unknown;
  try {
    const text =
      event.isBase64Encoded && event.body
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : (event.body ?? '');
    rawBody = JSON.parse(text);
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) return jsonResponse(400, { error: 'Invalid request', issues: parsed.error.issues });

  const { requestId, nodeId, selectedText, instruction } = parsed.data;

  try {
    const store = await getWorkflowBlobStore(event);
    const raw = await store.get(recordKey(requestId));
    if (!raw) return jsonResponse(404, { error: 'Workflow record not found', not_found: true });

    const record = JSON.parse(raw) as WorkflowRecord;
    const articleBody = record.input.content?.article_body;
    if (!articleBody) return jsonResponse(404, { error: 'Article body not found in workflow record' });

    const nodes = articleBody.nodes as ArticleBodyNode[];
    const targetNode = nodes.find((n) => n.id === nodeId);
    if (!targetNode) return jsonResponse(404, { error: `Node ${nodeId} not found` });

    const articleTitle = record.input.content?.title ?? '';
    const context = buildContext(articleBody, nodeId, articleTitle);

    const currentContent = JSON.stringify(targetNode.public, null, 2);
    const selectionClause = selectedText
      ? `\nThe editor highlighted this specific span: """${selectedText}"""\n`
      : '';

    const userMessage = [
      'You are editing a block of content within a published article.',
      '',
      'Surrounding article context (for coherence only, do not modify):',
      context,
      '',
      'Current content of the block being edited:',
      '```json',
      currentContent,
      '```',
      selectionClause,
      `Editor's instruction: ${instruction}`,
      '',
      'Call update_node_content with ONLY the fields that should change. Do not include fields that stay the same. Preserve the voice, tone, and brand style of the surrounding content.',
    ]
      .filter((line) => line !== null)
      .join('\n');

    const anthropicResponse = await callAnthropic([{ role: 'user', content: userMessage }], apiKey, model);

    const response = anthropicResponse as {
      content?: Array<{ type: string; name?: string; input?: AnthropicToolInput }>;
    };

    const toolUse = response.content?.find((block) => block.type === 'tool_use' && block.name === 'update_node_content');
    if (!toolUse?.input) {
      return jsonResponse(502, { error: 'AI did not return a structured suggestion' });
    }

    // Strip undefined/null values before returning
    const suggestion: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(toolUse.input)) {
      if (value !== undefined && value !== null) suggestion[key] = value;
    }

    return jsonResponse(200, { suggestion, nodeId });
  } catch (error) {
    console.error('admin-ask-ai-node failed', { requestId, nodeId, error });
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'AI suggestion failed',
    });
  }
};
