import { randomUUID } from 'node:crypto';

import { connectLambda, getStore } from '@netlify/blobs';

type LambdaEvent = {
  blobs?: string;
  body?: string | null;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  isBase64Encoded?: boolean;
};

type FormField = {
  name: string;
  value: string;
};

type UploadedFile = {
  fieldName: string;
  fileName: string;
  mimeType: string;
  data: Buffer;
};

type MultipartParseResult = {
  fields: FormField[];
  files: UploadedFile[];
};

const allowedMimeTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain']);
const jsonHeaders = {
  'Content-Type': 'application/json',
};
const maxUploadBytes = 5 * 1024 * 1024;

const getHeader = (headers: LambdaEvent['headers'], name: string) => {
  const normalizedName = name.toLowerCase();
  const match = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === normalizedName);

  return match?.[1];
};

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify(body),
});

const getMultipartBoundary = (contentType: string) => {
  const match = contentType.match(/(?:^|;)\s*boundary=(?:("[^"]+")|([^;]+))/i);
  const boundary = match?.[1]?.slice(1, -1) ?? match?.[2]?.trim();

  return boundary || undefined;
};

const parseContentDisposition = (value: string) => {
  const params = new Map<string, string>();

  for (const part of value.split(';').slice(1)) {
    const [rawKey, ...rawValue] = part.split('=');
    const key = rawKey?.trim().toLowerCase();
    const joinedValue = rawValue.join('=').trim();

    if (!key || !joinedValue) {
      continue;
    }

    params.set(key, joinedValue.replace(/^"|"$/g, ''));
  }

  return {
    fileName: params.get('filename'),
    name: params.get('name'),
  };
};

const parsePartHeaders = (headerBlock: string) => {
  const headers = new Map<string, string>();

  for (const line of headerBlock.split('\r\n')) {
    const separatorIndex = line.indexOf(':');

    if (separatorIndex === -1) {
      continue;
    }

    headers.set(line.slice(0, separatorIndex).trim().toLowerCase(), line.slice(separatorIndex + 1).trim());
  }

  return headers;
};

const parseMultipart = (body: Buffer, boundary: string): MultipartParseResult => {
  const delimiter = Buffer.from(`--${boundary}`);
  const boundaryPrefix = Buffer.from(`\r\n--${boundary}`);
  const fields: FormField[] = [];
  const files: UploadedFile[] = [];
  let cursor = 0;

  while (cursor < body.length) {
    const delimiterIndex = body.indexOf(delimiter, cursor);

    if (delimiterIndex === -1) {
      break;
    }

    let partStart = delimiterIndex + delimiter.length;

    if (body.subarray(partStart, partStart + 2).toString() === '--') {
      break;
    }

    if (body.subarray(partStart, partStart + 2).toString() === '\r\n') {
      partStart += 2;
    }

    const headersEnd = body.indexOf('\r\n\r\n', partStart);

    if (headersEnd === -1) {
      break;
    }

    const nextBoundary = body.indexOf(boundaryPrefix, headersEnd + 4);

    if (nextBoundary === -1) {
      break;
    }

    const headers = parsePartHeaders(body.subarray(partStart, headersEnd).toString('utf8'));
    const disposition = headers.get('content-disposition');

    if (disposition) {
      const { fileName, name } = parseContentDisposition(disposition);
      const partData = body.subarray(headersEnd + 4, nextBoundary);

      if (name && fileName) {
        files.push({
          data: partData,
          fieldName: name,
          fileName,
          mimeType: headers.get('content-type') ?? 'application/octet-stream',
        });
      } else if (name) {
        fields.push({ name, value: partData.toString('utf8').trim() });
      }
    }

    cursor = nextBoundary + boundaryPrefix.length;
  }

  return { fields, files };
};

const getFieldValue = (fields: FormField[], names: string[]) => {
  const lowerCaseNames = new Set(names.map((name) => name.toLowerCase()));
  const field = fields.find(({ name }) => lowerCaseNames.has(name.toLowerCase()));

  return field?.value || undefined;
};

const safeFileName = (fileName: string) => {
  const baseName = fileName.split(/[\\/]/).pop() ?? 'upload';
  const normalized = baseName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 120);

  return normalized || 'upload';
};

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const contentType = getHeader(event.headers, 'content-type') ?? '';
  const boundary = getMultipartBoundary(contentType);

  if (!contentType.toLowerCase().includes('multipart/form-data') || !boundary) {
    return jsonResponse(415, { error: 'Expected multipart/form-data with a file field.' });
  }

  if (!event.body) {
    return jsonResponse(400, { error: 'Upload request body is required.' });
  }

  try {
    const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body, 'utf8');
    const { fields, files } = parseMultipart(body, boundary);
    const file = files[0];

    if (!file) {
      return jsonResponse(400, { error: 'No file was provided.' });
    }

    if (files.length > 1) {
      return jsonResponse(400, { error: 'Only one file can be uploaded per request.' });
    }

    if (file.data.length === 0) {
      return jsonResponse(400, { error: 'File is empty.' });
    }

    if (file.data.length > maxUploadBytes) {
      return jsonResponse(413, { error: 'File is too large.', maxBytes: maxUploadBytes });
    }

    if (!allowedMimeTypes.has(file.mimeType)) {
      return jsonResponse(415, {
        allowedMimeTypes: Array.from(allowedMimeTypes),
        error: 'File type is not allowed.',
      });
    }

    connectLambda(event);

    const uploadedAt = new Date().toISOString();
    const key = `uploads/${uploadedAt.slice(0, 10)}/${randomUUID()}-${safeFileName(file.fileName)}`;
    const email = getFieldValue(fields, ['email']);
    const formName = getFieldValue(fields, ['formName', 'form-name']);
    const metadata: Record<string, string> = {
      fieldName: file.fieldName,
      mimeType: file.mimeType,
      originalFileName: file.fileName,
      size: String(file.data.length),
      uploadedAt,
    };

    if (email) {
      metadata.email = email;
    }

    if (formName) {
      metadata.formName = formName;
    }

    const store = getStore('uploads');

    await store.set(key, file.data, {
      metadata,
      type: file.mimeType,
    });

    return jsonResponse(201, {
      key,
      metadata,
      ok: true,
    });
  } catch (error) {
    console.error('Failed to save upload to Netlify Blobs.', error);

    return jsonResponse(500, { error: 'Upload could not be saved.' });
  }
};
