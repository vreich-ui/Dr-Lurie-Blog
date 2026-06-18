import dns from 'node:dns/promises';
import { isIP } from 'node:net';

import {
  getDirectArtifactUploadMaxBytes,
  saveArtifactBytes,
  type SaveArtifactBytesResult,
} from './artifact-upload.js';
import { type ArtifactKind } from './artifacts.js';
import { sha256Hex } from './crypto.js';

export type SaveArtifactFromUrlInput = {
  requestId: string;
  artifactKind: ArtifactKind;
  contentType: string;
  sourceUrl: string;
  expectedSizeBytes: number;
  expectedSha256: string;
  filename?: string;
  label?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  event?: unknown;
};

export type SaveArtifactFromUrlResult = SaveArtifactBytesResult & {
  sourceUrl: string;
  fetchedBytes?: number;
  maxBytes?: number;
};

const FETCH_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;

/**
 * Internal utilities that can be mocked in tests.
 */
export const _ingestInternal = {
  dnsLookup: async (hostname: string) => {
    return await dns.lookup(hostname, { all: true });
  },
  fetch: async (url: string, init?: RequestInit) => {
    return await fetch(url, init);
  },
};

/**
 * Validates that an IP address is a public, non-loopback, non-private address.
 */
const isSafeIp = (ip: string): boolean => {
  if (isIP(ip) === 4) {
    const parts = ip.split('.').map(Number);
    // Loopback: 127.0.0.0/8
    if (parts[0] === 127) return false;
    // Private: 10.0.0.0/8
    if (parts[0] === 10) return false;
    // Private: 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
    // Private: 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return false;
    // Link-local / Metadata: 169.254.0.0/16
    if (parts[0] === 169 && parts[1] === 254) return false;
    // Broadcast: 255.255.255.255
    if (ip === '255.255.255.255') return false;

    return true;
  }

  if (isIP(ip) === 6) {
    // Loopback: ::1
    if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return false;
    // Unique Local: fc00::/7
    if (ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd')) return false;
    // Link-local: fe80::/10
    if (ip.toLowerCase().startsWith('fe8') || ip.toLowerCase().startsWith('fe9') || ip.toLowerCase().startsWith('fea') || ip.toLowerCase().startsWith('feb')) return false;

    return true;
  }

  return false;
};

const validateUrlSafety = async (url: URL) => {
  if (url.protocol !== 'https:') {
    throw new Error('Only https: URLs are allowed for artifact ingestion.');
  }

  if (url.username || url.password) {
    throw new Error('URLs with credentials are not allowed for artifact ingestion.');
  }

  const hostname = url.hostname;
  if (!hostname) {
    throw new Error('Invalid source URL: missing hostname.');
  }

  // If it's already an IP, validate it.
  if (isIP(hostname)) {
    if (!isSafeIp(hostname)) {
      throw new Error(`Forbidden source IP address: ${hostname}`);
    }
    return;
  }

  // Resolve hostname and validate all returned IPs.
  try {
    const result = await _ingestInternal.dnsLookup(hostname);
    if (!result.length) {
      throw new Error(`Could not resolve hostname: ${hostname}`);
    }
    for (const entry of result) {
      if (!isSafeIp(entry.address)) {
        throw new Error(`Forbidden source IP address resolved for ${hostname}: ${entry.address}`);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Forbidden source IP')) {
      throw error;
    }
    throw new Error(`Failed to resolve hostname ${hostname}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export const fetchArtifactBytesFromUrl = async (
  input: Pick<SaveArtifactFromUrlInput, 'sourceUrl' | 'expectedSizeBytes' | 'expectedSha256'>
): Promise<Buffer> => {
  let currentUrlString = input.sourceUrl;
  let redirects = 0;
  const maxBytes = getDirectArtifactUploadMaxBytes();

  while (true) {
    const url = new URL(currentUrlString);
    await validateUrlSafety(url);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await _ingestInternal.fetch(currentUrlString, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Netlify-Artifact-Ingest/1.0',
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error(`Redirect status ${response.status} received without Location header.`);
        }
        if (redirects >= MAX_REDIRECTS) {
          throw new Error(`Maximum redirect limit of ${MAX_REDIRECTS} exceeded.`);
        }
        currentUrlString = new URL(location, currentUrlString).toString();
        redirects++;
        continue;
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch artifact from URL: HTTP ${response.status} ${response.statusText}`);
      }

      const contentLengthHeader = response.headers.get('content-length');
      if (contentLengthHeader) {
        const contentLength = parseInt(contentLengthHeader, 10);
        if (Number.isInteger(contentLength) && contentLength > maxBytes) {
          throw new Error(`Artifact size from Content-Length (${contentLength}) exceeds limit of ${maxBytes} bytes.`);
        }
      }

      const arrayBuffer = await response.arrayBuffer();
      const bytes = Buffer.from(arrayBuffer);

      if (bytes.length > maxBytes) {
        throw new Error(`Fetched artifact size (${bytes.length}) exceeds limit of ${maxBytes} bytes.`);
      }

      if (bytes.length !== input.expectedSizeBytes) {
        throw new Error(`Artifact size mismatch: expected ${input.expectedSizeBytes} bytes, received ${bytes.length} bytes.`);
      }

      const actualSha256 = sha256Hex(bytes);
      if (actualSha256 !== input.expectedSha256.toLowerCase()) {
        throw new Error(`Artifact sha256 mismatch: expected ${input.expectedSha256}, received ${actualSha256}.`);
      }

      return bytes;
    } finally {
      clearTimeout(timeoutId);
    }
  }
};

export const saveArtifactFromUrl = async (input: SaveArtifactFromUrlInput): Promise<SaveArtifactFromUrlResult> => {
  const maxBytes = getDirectArtifactUploadMaxBytes();
  try {
    const bytes = await fetchArtifactBytesFromUrl({
      sourceUrl: input.sourceUrl,
      expectedSizeBytes: input.expectedSizeBytes,
      expectedSha256: input.expectedSha256,
    });

    const saveResult = await saveArtifactBytes({
      requestId: input.requestId,
      artifactKind: input.artifactKind,
      contentType: input.contentType,
      expectedSizeBytes: input.expectedSizeBytes,
      expectedSha256: input.expectedSha256,
      filename: input.filename,
      label: input.label,
      tags: input.tags,
      bytes: bytes,
      metadata: input.metadata,
      event: input.event,
    });

    return {
      ...saveResult,
      sourceUrl: input.sourceUrl,
      fetchedBytes: bytes.length,
      maxBytes,
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: (error as { statusCode?: number }).statusCode || 400,
      error: error instanceof Error ? error.message : String(error),
      sourceUrl: input.sourceUrl,
      maxBytes,
    };
  }
};
