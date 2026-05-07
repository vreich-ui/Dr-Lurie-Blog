import { randomUUID } from 'node:crypto';

import { connectLambda, getStore } from '@netlify/blobs';

type LambdaEvent = {
  blobs?: string;
  body?: string | null;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  isBase64Encoded?: boolean;
};

type OptInInput = {
  consent?: unknown;
  consentText?: unknown;
  consentType?: unknown;
  email?: unknown;
  formName?: unknown;
  name?: unknown;
  pathname?: unknown;
  source?: unknown;
};

type OptInRecord = {
  formName: string;
  submittedAt: string;
  userAgent?: string;
  email?: string;
  name?: string;
  source?: string;
  consent?: string;
};

const jsonHeaders = {
  'Content-Type': 'application/json',
};

const getHeader = (headers: LambdaEvent['headers'], name: string) => {
  const normalizedName = name.toLowerCase();
  const match = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === normalizedName);

  return match?.[1];
};

const toStringValue = (value: unknown) => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
};

const parseBody = (event: LambdaEvent): OptInInput | undefined => {
  if (!event.body) {
    return undefined;
  }

  const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  const contentType = getHeader(event.headers, 'content-type') ?? '';

  if (contentType.includes('application/json')) {
    const parsed = JSON.parse(body) as unknown;

    return parsed && typeof parsed === 'object' ? (parsed as OptInInput) : undefined;
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(body);

    return Object.fromEntries(params.entries());
  }

  return undefined;
};

const buildRecord = (input: OptInInput, userAgent?: string): OptInRecord | undefined => {
  const formName = toStringValue(input.formName);

  if (!formName) {
    return undefined;
  }

  const consent = toStringValue(input.consentText) ?? toStringValue(input.consentType) ?? toStringValue(input.consent);
  const source = toStringValue(input.source) ?? toStringValue(input.pathname);
  const record: OptInRecord = {
    formName,
    submittedAt: new Date().toISOString(),
  };

  const email = toStringValue(input.email);
  const name = toStringValue(input.name);

  if (email) {
    record.email = email;
  }

  if (name) {
    record.name = name;
  }

  if (source) {
    record.source = source;
  }

  if (consent) {
    record.consent = consent;
  }

  if (userAgent) {
    record.userAgent = userAgent;
  }

  return record;
};

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const input = parseBody(event);
    const record = input ? buildRecord(input, getHeader(event.headers, 'user-agent')) : undefined;

    if (!record) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ error: 'A formName is required to save opt-in metadata.' }),
      };
    }

    connectLambda(event);

    const date = record.submittedAt.slice(0, 10);
    const key = `opt-ins/${date}/${randomUUID()}.json`;
    const store = getStore('opt-ins');

    await store.setJSON(key, record, {
      metadata: {
        formName: record.formName,
        submittedAt: record.submittedAt,
      },
    });

    return {
      statusCode: 202,
      headers: jsonHeaders,
      body: JSON.stringify({ key, ok: true }),
    };
  } catch (error) {
    console.error('Failed to save opt-in metadata to Netlify Blobs.', error);

    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Opt-in metadata could not be saved.' }),
    };
  }
};
