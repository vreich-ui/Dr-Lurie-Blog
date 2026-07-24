/**
 * Per-agent credentials (W11 T11.10, OQ-W11-5 ruling — the MINIMAL
 * verifiable-per-agent-token slice, not a full IAM).
 *
 * Today's trust model (creation-policy.ts's own honest caveat, unchanged
 * until this file existed): `agent_name` is SELF-DECLARED over the shared
 * publish key — a coordination seam, not a security boundary. This module
 * is the verifiable alternative: a per-agent token, hashed and stored in the
 * SAME `governance` blob store admin-governance.ts already owns (a new doc
 * key, `agent-keys.v1` — no new blob store, no change to the T11.7-pinned
 * `CORE_BLOB_STORES` list), resolved back to a verified `agent_name` when
 * presented as `Authorization: Bearer <token>`.
 *
 * Design constraints:
 *   - The RAW token is never stored — only its sha256 hash. `createAgentKey`
 *     returns the raw token exactly once (to the caller minting it); losing
 *     it means minting a new one, the same posture as every other secret in
 *     this project (PUBLISH_SECRET, TRACKING_SALT, …).
 *   - One ACTIVE key per (agent_name, site) — minting a new key for an
 *     agent that already has one auto-revokes the old one first, so keys
 *     never silently accumulate.
 *   - `resolveVerifiedAgentName` is PURE (no store access) — given an
 *     already-loaded doc, a token, and a site scope, it is unit-testable
 *     against the adversarial cases T11.10 requires: a revoked key fails
 *     closed even with the right token; a key scoped to a DIFFERENT site
 *     never matches (multi-tenant isolation — OQ-W11-4's "no shared
 *     credential surface across clients", now enforced for agent tokens
 *     too, not just Netlify's own per-site blob namespacing).
 *   - This is attribution, not authorization: a verified token identifies
 *     WHO is calling; it does not itself grant any capability beyond what
 *     creation-policy/approval-policy already allow that agent_name. A
 *     forged agent_name with no matching token simply never resolves here
 *     and falls through to the existing self-declared (unverified) path —
 *     unchanged, deliberately not removed (no forced cutover, per the
 *     brief's non-goals).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const AGENT_KEYS_DOC_KEY = 'agent-keys.v1';

export const agentKeyStatusSchema = z.enum(['active', 'revoked']);
export type AgentKeyStatus = z.infer<typeof agentKeyStatusSchema>;

export const agentKeyRecordSchema = z.object({
  agent_name: z.string().min(1),
  /** sha256 hex of the raw token — the raw value is never persisted. */
  token_hash: z.string().min(1),
  status: agentKeyStatusSchema,
  /** The site scope this key is valid for (SiteIdentity.siteId, e.g. 'site_drlurie') — never crosses bindings. */
  site: z.string().min(1),
  created_by: z.string().min(1),
  created_at: z.string(),
  revoked_at: z.string().optional(),
});
export type AgentKeyRecord = z.infer<typeof agentKeyRecordSchema>;

export const agentKeysDocSchema = z.object({
  schema_version: z.literal('agent-keys.v1'),
  keys: z.array(agentKeyRecordSchema),
  updated_by: z.string(),
  updated_at: z.string(),
});
export type AgentKeysDoc = z.infer<typeof agentKeysDocSchema>;

export const emptyAgentKeysDoc = (updated_by: string, now: string): AgentKeysDoc => ({
  schema_version: 'agent-keys.v1',
  keys: [],
  updated_by,
  updated_at: now,
});

export interface AgentKeysBlobStore {
  get(key: string): Promise<string | null>;
  setJSON(key: string, value: unknown): Promise<void | { modified: boolean; etag?: string }>;
}

/** Read + validate the doc. Missing OR corrupt → null (no verified agents — everything falls through to the self-declared path, never a crash). */
export const getAgentKeysDoc = async (store: AgentKeysBlobStore): Promise<AgentKeysDoc | null> => {
  const raw = await store.get(AGENT_KEYS_DOC_KEY);
  if (!raw) return null;
  try {
    return agentKeysDocSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const putAgentKeysDoc = async (store: AgentKeysBlobStore, doc: AgentKeysDoc): Promise<void> => {
  await store.setJSON(AGENT_KEYS_DOC_KEY, agentKeysDocSchema.parse(doc));
};

export const hashAgentToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

/** 256 bits of randomness, URL-safe — long enough to defeat guessing, short enough to paste into an Authorization header by hand. */
export const mintAgentToken = (): string => randomBytes(32).toString('base64url');

const hashesMatch = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
};

export type CreateAgentKeyInput = { agent_name: string; site: string; created_by: string; now: string };
export type CreateAgentKeyResult = { doc: AgentKeysDoc; token: string; record: AgentKeyRecord };

/**
 * Mints a fresh token for (agent_name, site), auto-revoking any existing
 * ACTIVE key for that same pair first (the one-active-key invariant). The
 * raw `token` is returned ONCE here — callers must hand it to the agent
 * immediately and never log or persist it themselves.
 */
export const createAgentKey = (doc: AgentKeysDoc, input: CreateAgentKeyInput): CreateAgentKeyResult => {
  const token = mintAgentToken();
  const record: AgentKeyRecord = {
    agent_name: input.agent_name,
    token_hash: hashAgentToken(token),
    status: 'active',
    site: input.site,
    created_by: input.created_by,
    created_at: input.now,
  };
  const keys = doc.keys.map((k) =>
    k.agent_name === input.agent_name && k.site === input.site && k.status === 'active'
      ? { ...k, status: 'revoked' as const, revoked_at: input.now }
      : k
  );
  return {
    doc: { ...doc, keys: [...keys, record], updated_by: input.created_by, updated_at: input.now },
    token,
    record,
  };
};

export type RevokeAgentKeyInput = { agent_name: string; site: string; revoked_by: string; now: string };

/** Revokes every ACTIVE key for (agent_name, site) — a no-op (returns the doc unchanged) if none is active. */
export const revokeAgentKey = (doc: AgentKeysDoc, input: RevokeAgentKeyInput): AgentKeysDoc => ({
  ...doc,
  keys: doc.keys.map((k) =>
    k.agent_name === input.agent_name && k.site === input.site && k.status === 'active'
      ? { ...k, status: 'revoked' as const, revoked_at: input.now }
      : k
  ),
  updated_by: input.revoked_by,
  updated_at: input.now,
});

/**
 * PURE resolution — no store access. Given a bearer token, the site scope
 * of the CURRENT request, and an already-loaded doc, returns the verified
 * `agent_name` if an ACTIVE key for THIS site's hash matches — else `null`,
 * meaning "not a verified agent" (the caller falls through to the existing
 * self-declared/shared-key path, unchanged). A revoked key, a key scoped to
 * a different site, or an unknown token all resolve to `null` — fails
 * closed in every case, never open.
 */
export const resolveVerifiedAgentName = (token: string, site: string, doc: AgentKeysDoc | null): string | null => {
  if (!doc || !token) return null;
  const tokenHash = hashAgentToken(token);
  const match = doc.keys.find((k) => k.site === site && k.status === 'active' && hashesMatch(k.token_hash, tokenHash));
  return match?.agent_name ?? null;
};

/** Read-model for admin surfaces — never includes `token_hash`. */
export const describeAgentKeys = (doc: AgentKeysDoc | null): Omit<AgentKeyRecord, 'token_hash'>[] =>
  (doc?.keys ?? []).map(({ token_hash: _tokenHash, ...rest }) => rest);
