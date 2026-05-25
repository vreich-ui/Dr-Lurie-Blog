import { timingSafeEqual } from 'node:crypto';

import { handler as publishArticleHandler } from './publish-article.js';

type LambdaEvent = {
  body?: string | null;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  isBase64Encoded?: boolean;
};

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const getHeader = (headers: Record<string, string | undefined> | undefined, name: string) => {
  if (!headers) return '';
  const target = name.toLowerCase();
  const pair = Object.entries(headers).find(([key]) => key.toLowerCase() === target);
  return pair?.[1]?.trim() ?? '';
};

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify(body),
});

const secretsMatch = (provided: string, expected: string) => {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
};

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const expectedAgentSecret = process.env.AGENT_PUBLISH_SECRET;
  if (!expectedAgentSecret) {
    return jsonResponse(500, { error: 'AGENT_PUBLISH_SECRET is not configured.' });
  }

  const providedAgentSecret = getHeader(event.headers, 'x-agent-publish-key');
  if (!providedAgentSecret || !secretsMatch(providedAgentSecret, expectedAgentSecret)) {
    return jsonResponse(401, { error: 'Invalid or missing x-agent-publish-key.' });
  }

  let parsedBody: Record<string, unknown>;
  try {
    const body = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
    parsedBody = body ? (JSON.parse(body) as Record<string, unknown>) : {};
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body.' });
  }

  const required = ['slug'];
  const missing = required.filter((field) => typeof parsedBody[field] !== 'string' || !(parsedBody[field] as string).trim());
  if (!('markdown' in parsedBody) && !('content' in parsedBody)) {
    missing.push('markdown or content');
  }
  if (missing.length) {
    return jsonResponse(400, { error: `Missing required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` });
  }

  const publishSecret = process.env.PUBLISH_SECRET;
  if (!publishSecret) {
    return jsonResponse(500, { error: 'PUBLISH_SECRET is not configured.' });
  }

  const proxyEvent: LambdaEvent = {
    httpMethod: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-publish-key': publishSecret,
    },
    body: JSON.stringify(parsedBody),
    isBase64Encoded: false,
  };

  return publishArticleHandler(proxyEvent);
};
