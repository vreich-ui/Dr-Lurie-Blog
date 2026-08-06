import { publicPathForArtifactRef } from './artifact-trust.js';
import type { PdfToolStorageGrant } from './pdf-tool-storage-grant.js';

type EnvSource = Record<string, string | undefined>;

export type PdfToolClientOptions = {
  env?: EnvSource;
  fetchImpl?: typeof fetch;
};

export type PdfToolCallResult =
  | { ok: true; statusCode: number; body: Record<string, unknown>; internalMaterializationProof?: string }
  | { ok: false; statusCode: number; error: string; body?: Record<string, unknown> };

const nonEmpty = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const resolvePdfToolClientConfig = (env: EnvSource = process.env) => {
  const baseUrl = nonEmpty(env.PDF_TOOL_BASE_URL)?.replace(/\/+$/, '');
  const token = nonEmpty(env.PDF_TOOL_AGENT_RUN_TOKEN);
  const missing = [...(baseUrl ? [] : ['PDF_TOOL_BASE_URL']), ...(token ? [] : ['PDF_TOOL_AGENT_RUN_TOKEN'])];
  return missing.length > 0
    ? {
        ok: false as const,
        error: `Platform's pdf-tool bridge is not configured (missing ${missing.join(' and ')}).`,
        errorCode: 'pdf_tool_bridge_not_configured' as const,
      }
    : { ok: true as const, baseUrl: baseUrl!, token: token! };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

/** Remove request-only capabilities before anything can reach an MCP response or log. */
export const sanitizePdfToolPayload = (value: unknown, secrets: string[] = []): unknown => {
  if (typeof value === 'string') {
    return secrets.filter(Boolean).reduce((safe, secret) => safe.split(secret).join('[REDACTED]'), value);
  }
  if (Array.isArray(value)) return value.map((child) => sanitizePdfToolPayload(child, secrets));
  if (!isRecord(value)) return value;

  const safe: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (['storage', 'token', 'materializationProof', 'materialization_proof'].includes(key)) continue;
    safe[key] = sanitizePdfToolPayload(child, secrets);
  }
  return safe;
};

const postPdfTool = async (
  functionName: string,
  payload: Record<string, unknown>,
  options: PdfToolClientOptions = {}
): Promise<PdfToolCallResult> => {
  const config = resolvePdfToolClientConfig(options.env);
  if (!config.ok) return { ok: false, statusCode: 503, error: config.error };

  let response: Response;
  try {
    response = await (options.fetchImpl ?? globalThis.fetch)(`${config.baseUrl}/.netlify/functions/${functionName}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, statusCode: 502, error: 'pdf-tool is unreachable from Platform.' };
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    return { ok: false, statusCode: 502, error: `pdf-tool returned a non-JSON response (HTTP ${response.status}).` };
  }
  const internalMaterializationProof =
    isRecord(raw) && typeof raw.materializationProof === 'string' ? raw.materializationProof : undefined;
  const storageToken =
    isRecord(payload.storage) && typeof payload.storage.token === 'string' ? payload.storage.token : undefined;
  const safe = sanitizePdfToolPayload(raw, [config.token, ...(storageToken ? [storageToken] : [])]);
  const body = isRecord(safe) ? safe : {};
  if (!response.ok) {
    return {
      ok: false,
      statusCode: response.status,
      error: typeof body.error === 'string' ? body.error : `pdf-tool request failed (HTTP ${response.status}).`,
      body,
    };
  }
  return { ok: true, statusCode: response.status, body, internalMaterializationProof };
};

export type PlatformArtifactJobInput = {
  requestId: string;
  artifactKind: 'image' | 'pdf';
  operation?: 'generate' | 'edit';
  prompt?: string;
  filename: string;
  slot?: string;
  model?: string;
  requirements?: Record<string, unknown>;
  templateId?: string;
  templateRef?: { storeName?: string; blobKey: string; version?: number };
  data?: unknown;
  assets?: { images?: unknown[] };
};

const projectPayload = (grant: PdfToolStorageGrant, payload: Record<string, unknown>) => ({
  ...payload,
  projectId: grant.projectId,
  storage: grant,
});

export const createPlatformArtifactJob = (
  grant: PdfToolStorageGrant,
  input: PlatformArtifactJobInput,
  options: PdfToolClientOptions = {}
) =>
  postPdfTool(
    'create-agent-artifact-job',
    projectPayload(grant, {
      requestId: input.requestId,
      artifactKind: input.artifactKind,
      operation: input.operation ?? 'generate',
      prompt: input.prompt,
      filename: input.filename,
      slot: input.slot,
      model: input.model,
      requirements: input.requirements,
      templateId: input.templateId,
      templateRef: input.templateRef,
      data: input.data,
      assets: input.assets,
    }),
    options
  );

export const getPlatformArtifactJobStatus = (
  grant: PdfToolStorageGrant,
  jobId: string,
  options: PdfToolClientOptions = {}
) => postPdfTool('get-agent-artifact-job-status', projectPayload(grant, { jobId }), options);

export const getPlatformArtifactBySlot = (
  grant: PdfToolStorageGrant,
  requestId: string,
  slot: string,
  options: PdfToolClientOptions = {}
) => postPdfTool('get-agent-artifact-by-slot', projectPayload(grant, { requestId, slot }), options);

export const verifyPlatformArtifact = (
  grant: PdfToolStorageGrant,
  requestId: string,
  artifactReference: Record<string, unknown>,
  materializationProof: string | undefined,
  options: PdfToolClientOptions = {}
) =>
  postPdfTool(
    'verify-agent-artifact',
    projectPayload(grant, { requestId, artifactReference, materializationProof }),
    options
  );

export type PlatformCreateTemplateInput = {
  templateJson: unknown;
  renderer?: 'pdfme' | 'react-pdf' | 'typst' | 'chromium';
  templateId?: string;
  label?: string;
  tags?: string[];
};

export const createPlatformPdfTemplate = (
  grant: PdfToolStorageGrant,
  input: PlatformCreateTemplateInput,
  options: PdfToolClientOptions = {}
) =>
  postPdfTool(
    'create-pdf-template',
    projectPayload(grant, {
      templateJson: input.templateJson,
      ...(input.renderer ? { renderer: input.renderer } : {}),
      ...(input.templateId ? { templateId: input.templateId } : {}),
      ...(input.label ? { label: input.label } : {}),
      ...(input.tags ? { tags: input.tags } : {}),
    }),
    options
  );

export const listPlatformPdfTemplates = (
  grant: PdfToolStorageGrant,
  input: { limit?: number; cursor?: string } = {},
  options: PdfToolClientOptions = {}
) =>
  postPdfTool(
    'list-pdf-templates',
    projectPayload(grant, {
      ...(input.limit ? { limit: input.limit } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
    }),
    options
  );

export const getPlatformPdfTemplate = (
  grant: PdfToolStorageGrant,
  input: { templateId: string; version?: number },
  options: PdfToolClientOptions = {}
) =>
  postPdfTool(
    'get-pdf-template',
    projectPayload(grant, {
      templateId: input.templateId,
      ...(input.version ? { version: input.version } : {}),
    }),
    options
  );

export const publishPlatformPdfTemplate = (
  grant: PdfToolStorageGrant,
  input: { templateId: string; version?: number },
  options: PdfToolClientOptions = {}
) =>
  postPdfTool(
    'publish-pdf-template',
    projectPayload(grant, {
      templateId: input.templateId,
      ...(input.version ? { version: input.version } : {}),
    }),
    options
  );

/**
 * QA-W16-2: react-pdf/typst/chromium templates require a PASSED validation
 * report before publish_pdf_template will activate them (pdf-tool enforces
 * this; publishPlatformPdfTemplate surfaces the refusal as HTTP 409
 * TEMPLATE_VALIDATION_REQUIRED). Until this bridge existed, no site connector
 * could ever produce that report — validate_pdf_template and
 * get_pdf_template_validation are pdf-tool's own tools for exactly this, and
 * they require the same storage grant (siteId + token) that
 * createPlatformPdfTemplate above already mints and forwards server-side.
 * These two mirror that exact pattern: the grant is built here, forwarded to
 * pdf-tool, and never returned to the MCP caller.
 */
export const validatePlatformPdfTemplate = (
  grant: PdfToolStorageGrant,
  input: { templateId: string; version?: number },
  options: PdfToolClientOptions = {}
) =>
  postPdfTool(
    'validate-pdf-template',
    projectPayload(grant, {
      templateId: input.templateId,
      ...(input.version ? { version: input.version } : {}),
    }),
    options
  );

export const getPlatformPdfTemplateValidation = (
  grant: PdfToolStorageGrant,
  input: { templateId: string; version?: number; validationId?: string },
  options: PdfToolClientOptions = {}
) =>
  postPdfTool(
    'get-pdf-template-validation',
    projectPayload(grant, {
      templateId: input.templateId,
      ...(input.version ? { version: input.version } : {}),
      ...(input.validationId ? { validationId: input.validationId } : {}),
    }),
    options
  );

export const deletePlatformPdfTemplate = (
  grant: PdfToolStorageGrant,
  input: { templateId: string; version?: number; reason?: string },
  options: PdfToolClientOptions = {}
) =>
  postPdfTool(
    'delete-pdf-template',
    projectPayload(grant, {
      templateId: input.templateId,
      ...(input.version ? { version: input.version } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    }),
    options
  );

export const canonicalPlatformArtifact = (body: Record<string, unknown>) => {
  const reference = isRecord(body.artifactReference)
    ? body.artifactReference
    : isRecord(body.artifact)
      ? body.artifact
      : undefined;
  const blobKey = reference && typeof reference.blobKey === 'string' ? reference.blobKey : undefined;
  if (!reference || !blobKey) return undefined;
  return { artifactReference: reference, publicPath: publicPathForArtifactRef(blobKey) };
};
