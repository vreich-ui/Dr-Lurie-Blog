/**
 * Guardrails client (T9.15) — wrappers over admin-governance. read (any admin);
 * set / revert (Owner; the server 403s a non-owner).
 */
import type { GetToken } from '../edit-mode/verbs-client.js';

const ENDPOINT = '/.netlify/functions/admin-governance';

export type ApprovalMode = 'autonomous' | 'require-approval';
export type ApprovalMaster = 'all-autonomous' | 'all-require-approval';

export interface ApprovalConfig {
  master: ApprovalMaster;
  overrides: Partial<Record<string, ApprovalMode>>;
}

export interface GovernanceState {
  doc: { approval?: ApprovalConfig; creation?: unknown; chat_tools?: Record<string, string> } | null;
  committed: { approval: ApprovalConfig; creation: unknown };
  active: { approval: ApprovalConfig; creation: unknown; provenance: { approval: string; creation: string } };
}

async function post<T>(getToken: GetToken, body: Record<string, unknown>): Promise<T> {
  const token = await getToken();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error((json.error as string) || `Request failed (${res.status}).`);
  return json as T;
}

export const fetchGovernance = (getToken: GetToken) => post<GovernanceState>(getToken, { verb: 'get' });

export const setApprovalOverride = (getToken: GetToken, approval: ApprovalConfig) =>
  post<GovernanceState>(getToken, { verb: 'set', approval });

export const revertGovernance = (getToken: GetToken, target: 'approval' | 'creation' | 'chat_tools' | 'all') =>
  post<GovernanceState>(getToken, { verb: 'revert', target });

/** Effective mode for a type given a config (per-type override, else master). */
export const effectiveApprovalMode = (config: ApprovalConfig, type: string): ApprovalMode =>
  config.overrides[type] ?? (config.master === 'all-require-approval' ? 'require-approval' : 'autonomous');
