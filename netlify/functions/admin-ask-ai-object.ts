/**
 * Function name: Admin_Ask_AI_Object
 * Required method: POST
 * Auth: Netlify Identity (admin email allowlist).
 *
 * Generic Ask-AI for CMS objects (T1.6) — the browser-facing wrapper around
 * the pure core in netlify/lib/ask-ai-object.ts. Read-only with respect to
 * Netlify Blobs: takes no lock and writes nothing. Returns a suggestion the
 * reviewer applies through the object_patch verb (the T1.4 review path); it
 * never writes the record directly.
 *
 * This is a SEPARATE endpoint from the article admin-ask-ai-node.ts, which is
 * deliberately untouched (Tier 1 keeps its own path). Shared behavior — the
 * selection-based UX, the forced-tool call, null-stripping — is reused via the
 * core, not by modifying the article file.
 *
 * POST body: { object_type, object_id, section_id?, selected_text?, image_ref?, instruction }
 * (`section_id` scopes a PAGE request to one section instance; `image_ref`
 * carries a "Re: <image>" reference with its public URL — the edit-mode
 * canvas paths; see netlify/lib/ask-ai-object.ts.)
 * Requires OPENAI_API_KEY; model override via OPENAI_MODEL (default gpt-4o).
 */
import { z } from 'zod';

import { getAdminStateFromEvent, type LambdaContext } from '../lib/admin-auth.js';
import { getSiteObjectsBlobStore } from '../lib/blob-store.js';
import { askAiForObject, type AskAiObjectStore } from '../lib/ask-ai-object.js';

const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const bodySchema = z
  .object({
    object_type: z.string().min(1),
    object_id: z.string().min(1),
    section_id: z.string().min(1).optional(),
    selected_text: z.string().max(4000).optional(),
    // Canvas image chips ("Re: portrait.png"): prompt context only — the
    // copy-only guard still strips image fields from every suggestion.
    image_ref: z
      .object({
        field: z.string().min(1).max(200),
        name: z.string().min(1).max(200),
        url: z.string().url().max(2000),
      })
      .strict()
      .optional(),
    instruction: z.string().min(1).max(2000),
  })
  .strict();

type LambdaEvent = {
  body?: string | null;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  isBase64Encoded?: boolean;
};

const jsonResponse = (status: number, body: Record<string, unknown>) => ({
  statusCode: status,
  headers: jsonHeaders,
  body: JSON.stringify({ ok: status >= 200 && status < 300, status, ...body }),
});

export const handler = async (event: LambdaEvent, context?: LambdaContext) => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const adminState = await getAdminStateFromEvent(event, context);
  if (!adminState.authenticated) return jsonResponse(401, { error: adminState.error ?? 'Unauthorized' });
  if (!adminState.isAdmin) return jsonResponse(403, { error: 'Admin access required' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return jsonResponse(500, { error: 'OPENAI_API_KEY is not configured' });
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o';

  let rawBody: unknown;
  try {
    const text =
      event.isBase64Encoded && event.body ? Buffer.from(event.body, 'base64').toString('utf8') : (event.body ?? '');
    rawBody = JSON.parse(text);
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) return jsonResponse(400, { error: 'Invalid request', issues: parsed.error.issues });

  try {
    const store = (await getSiteObjectsBlobStore(event)) as unknown as AskAiObjectStore;
    const result = await askAiForObject(store, parsed.data, { apiKey, model });
    return jsonResponse(result.status, result.body);
  } catch (error) {
    console.error('admin-ask-ai-object failed', {
      object_type: parsed.data.object_type,
      object_id: parsed.data.object_id,
      error,
    });
    return jsonResponse(500, { error: error instanceof Error ? error.message : 'AI suggestion failed' });
  }
};
