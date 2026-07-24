/**
 * Function name: Admin_Governance
 * Required method: POST
 * Auth: read (Admin) · write (Owner). Runtime override layer over the committed
 * approval / creation policy levers (T9.15, OQ-W9-2).
 *
 * Verbs: get (doc + committed defaults + resolved active), set (Owner — write
 * an override), revert (Owner — clear an override so the committed default
 * stands). Every write appends to the doc history.
 */
import '../../src/config/policy-bindings.js'; // W11 T11.2: register site policy providers before active*Policy() runs
import { z } from 'zod';

import { getAdminStateFromEvent, type LambdaContext } from '../../packages/core/server/lib/admin-auth.js';
import { resolveRolesFromEvent } from '../../packages/core/server/lib/request-roles.js';
import { isOwner } from '../../packages/core/server/lib/roles.js';
import {
  getGovernanceBlobStore,
  getGovernanceDoc,
  putGovernanceDoc,
  resolveActivePolicies,
  chatToolAutonomySchema,
  type GovernanceDoc,
} from '../../packages/core/server/lib/governance-store.js';
import { CHAT_TOOLS, defaultAutonomyFor } from '../../packages/core/server/lib/agent/tools.js';
import { approvalPolicyConfigSchema, activeApprovalPolicy } from '../../packages/core/lib/approval-policy.js';
import { creationPolicyConfigSchema, activeCreationPolicy } from '../../packages/core/lib/creation-policy.js';

type LambdaEvent = {
  httpMethod?: string;
  body?: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
};

const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const jsonResponse = (status: number, body: Record<string, unknown>) => ({
  statusCode: status,
  headers: jsonHeaders,
  body: JSON.stringify({ ok: status >= 200 && status < 300, status, ...body }),
});

const requestSchema = z.discriminatedUnion('verb', [
  z.object({ verb: z.literal('get') }),
  z.object({
    verb: z.literal('set'),
    approval: approvalPolicyConfigSchema.optional(),
    creation: creationPolicyConfigSchema.optional(),
    chat_tools: chatToolAutonomySchema.optional(),
  }),
  z.object({ verb: z.literal('revert'), target: z.enum(['approval', 'creation', 'chat_tools', 'all']) }),
]);

const safeJsonParse = (event: LambdaEvent): { ok: true; value: unknown } | { ok: false } => {
  if (!event.body) return { ok: false };
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false };
  }
};

const nowIso = () => new Date().toISOString();
const committed = () => ({ approval: activeApprovalPolicy(), creation: activeCreationPolicy() });

/** The chat-tool catalog for the guardrails table — the SINGLE source is
 *  CHAT_TOOLS, so the UI can never drift from the tools the run loop actually
 *  wires. Each entry carries the class-derived default the override layers on
 *  top of (resolveAutonomy in agent/tools.ts). Static, so computed once. */
const chatToolsCatalog = CHAT_TOOLS.map((tool) => ({
  name: tool.name,
  tool_class: tool.toolClass,
  default: defaultAutonomyFor(tool),
  description: tool.description,
}));

export const handler = async (event: LambdaEvent, context?: LambdaContext) => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const adminState = await getAdminStateFromEvent(event, context);
  if (!adminState.authenticated) return jsonResponse(401, { error: adminState.error ?? 'Unauthorized' });

  const email = (adminState.email ?? '').trim().toLowerCase();
  const roles = await resolveRolesFromEvent(event, { kind: 'human', id: adminState.userId ?? '', email });
  if (!roles.includes('admin')) return jsonResponse(403, { error: 'Admin access required' });
  const owner = isOwner(roles);

  const parsed = safeJsonParse(event);
  if (!parsed.ok) return jsonResponse(400, { error: 'Invalid request body.' });
  const request = requestSchema.safeParse(parsed.value);
  if (!request.success) return jsonResponse(400, { error: 'Invalid request fields.', issues: request.error.issues });

  try {
    const store = await getGovernanceBlobStore(event);
    const req = request.data;

    if (req.verb === 'get') {
      return jsonResponse(200, {
        doc: await getGovernanceDoc(store),
        committed: committed(),
        active: await resolveActivePolicies(store),
        chat_tools_catalog: chatToolsCatalog,
      });
    }

    if (!owner) return jsonResponse(403, { error: 'Owner access required' });

    const existing: GovernanceDoc = (await getGovernanceDoc(store)) ?? {
      schema_version: 'overrides.v1',
      updated_by: email,
      updated_at: nowIso(),
      history: [],
    };

    let next: GovernanceDoc;
    if (req.verb === 'set') {
      const touched = [req.approval && 'approval', req.creation && 'creation', req.chat_tools && 'chat_tools']
        .filter(Boolean)
        .join(', ');
      next = {
        ...existing,
        ...(req.approval !== undefined ? { approval: req.approval } : {}),
        ...(req.creation !== undefined ? { creation: req.creation } : {}),
        ...(req.chat_tools !== undefined ? { chat_tools: req.chat_tools } : {}),
        updated_by: email,
        updated_at: nowIso(),
        history: [...existing.history, { at: nowIso(), actor_email: email, action: 'set', detail: touched || 'none' }],
      };
    } else {
      next = { ...existing, updated_by: email, updated_at: nowIso() };
      if (req.target === 'all') {
        delete next.approval;
        delete next.creation;
        delete next.chat_tools;
      } else {
        delete next[req.target];
      }
      next.history = [...existing.history, { at: nowIso(), actor_email: email, action: 'revert', detail: req.target }];
    }

    await putGovernanceDoc(store, next);
    return jsonResponse(200, {
      doc: next,
      committed: committed(),
      active: await resolveActivePolicies(store),
      chat_tools_catalog: chatToolsCatalog,
    });
  } catch (error) {
    console.error('Admin_Governance request failed.', error);
    return jsonResponse(500, { error: 'Governance request could not be processed.' });
  }
};
