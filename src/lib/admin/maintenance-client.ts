/**
 * Maintenance client (T9.24 reskin of /admin/blobs) — browser wrappers over
 * admin-blob-manager (action-dispatched POST) and admin-blob-store-diagnostics
 * (GET). Both are Owner-only; the server 403s a non-owner on every call
 * (T9.4) — this client surfaces that as a thrown Error, same as users-client.
 */
import type { GetToken } from '../edit-mode/verbs-client.js';

const MANAGER_ENDPOINT = '/.netlify/functions/admin-blob-manager';
const DIAGNOSTICS_ENDPOINT = '/.netlify/functions/admin-blob-store-diagnostics';

export interface BlobArtifactMetadata {
  label?: string;
  originalFilename?: string;
  tags?: string[];
  createdAtISO?: string;
  sizeBytes?: number;
  artifactKind?: 'image' | 'pdf' | 'video' | 'audio' | 'doc' | string;
  contentType?: string;
}

export interface BlobDetail {
  store: string;
  key: string;
  size: number;
  metadata: Record<string, unknown>;
  contentType?: string;
  encoding: 'text' | 'base64';
  truncated: boolean;
  content: string;
}

export interface StoreDiagnostic {
  storeName: string;
  source: string;
  explicitApiConfigUsed: boolean;
  lambdaBlobContextUsed: boolean;
  siteId: string;
}

async function callManager<T>(getToken: GetToken, action: string, payload: Record<string, unknown> = {}) {
  const token = await getToken();
  const res = await fetch(MANAGER_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.ok === false) throw new Error((json.error as string) || `Request failed (${res.status}).`);
  return json as T;
}

export const listStores = (getToken: GetToken) => callManager<{ stores: string[] }>(getToken, 'list-stores');

export const listBlobs = (getToken: GetToken, store: string, search?: string) =>
  callManager<{ store: string; count: number; truncated: boolean; keys: string[] }>(getToken, 'list-blobs', {
    store,
    search: search ?? '',
  });

export const getBlob = (getToken: GetToken, store: string, key: string) =>
  callManager<BlobDetail>(getToken, 'get-blob', { store, key });

export const setBlob = (
  getToken: GetToken,
  params: { store: string; key: string; content: string; contentType?: string }
) => callManager<{ store: string; key: string }>(getToken, 'set-blob', { encoding: 'text', ...params });

export const deleteBlob = (getToken: GetToken, store: string, key: string) =>
  callManager<{ store: string; key: string }>(getToken, 'delete-blob', { store, key });

export const duplicateBlob = (getToken: GetToken, store: string, key: string, targetKey: string) =>
  callManager<{ store: string; key: string; targetKey: string }>(getToken, 'duplicate-blob', {
    store,
    key,
    targetKey,
  });

export const renameBlob = (getToken: GetToken, store: string, key: string, targetKey: string) =>
  callManager<{ store: string; key: string; targetKey: string }>(getToken, 'rename-blob', { store, key, targetKey });

export const wipeStore = (getToken: GetToken, store: string) =>
  callManager<{ store: string; deleted: number }>(getToken, 'wipe-store', { store });

export const wipeAll = (getToken: GetToken) =>
  callManager<{ stores: Array<{ store: string; deleted: number }>; totalDeleted: number }>(getToken, 'wipe-all', {
    confirm: 'WIPE ALL',
  });

export const getArtifactMetadata = (getToken: GetToken, blobKey: string) =>
  callManager<{ artifact: BlobArtifactMetadata }>(getToken, 'get-artifact-metadata', { blobKey });

export const fetchDiagnostics = async (getToken: GetToken) => {
  const token = await getToken();
  const res = await fetch(DIAGNOSTICS_ENDPOINT, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.ok === false) throw new Error((json.error as string) || `Request failed (${res.status}).`);
  return json as {
    diagnostics: {
      workflows: StoreDiagnostic;
      siteObjects: StoreDiagnostic;
      artifactIndex: StoreDiagnostic;
      artifacts: StoreDiagnostic;
    };
  };
};
