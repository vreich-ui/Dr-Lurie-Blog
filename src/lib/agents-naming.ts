const MACHINE_SAFE_ID_RE = /^[a-z0-9_]+$/;
const REQUEST_ID_RE = /^req_[a-z0-9]+(?:_[a-z0-9]+)*_[a-z0-9]+(?:_[a-z0-9]+)*_\d{8}_\d{2}$/;
const TEMPLATE_ID_RE = /^tpl_[a-z0-9]+(?:_[a-z0-9]+)*_[a-z0-9]+(?:_[a-z0-9]+)*_[a-z0-9]+(?:_[a-z0-9]+)*_v\d+$/;
const PDF_SLOT_RE = /^(?:pdf|download)_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const IMAGE_SLOT_RE = /^img_[a-z0-9]+(?:_[a-z0-9]+)*(?:_\d{2})?$/;
const GENERIC_SLOT_RE = /^[a-z0-9]+_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FILENAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+)?$/;
const MULTI_UNDERSCORE_RE = /_+/g;
const MULTI_DASH_RE = /-+/g;
const TRIM_UNDERSCORE_RE = /^_+|_+$/g;
const TRIM_DASH_RE = /^-+|-+$/g;

export type AgentNamingKind = 'request_id' | 'template_id' | 'slot' | 'slug' | 'filename' | 'label' | 'cta_label';

export type NamingValidationResult = { ok: true; value: string } | { ok: false; error: string };

const compact = (value: string) => value.trim().replace(/\s+/g, ' ');

export const normalizeMachineSafeId = (value: string): string =>
  value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(MULTI_UNDERSCORE_RE, '_')
    .replace(TRIM_UNDERSCORE_RE, '');

export const normalizeSlug = (value: string): string =>
  value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(MULTI_DASH_RE, '-')
    .replace(TRIM_DASH_RE, '');

export const normalizeFilename = (value: string): string => {
  const trimmed = value.trim().split(/[\\/]/).pop() ?? '';
  const extensionMatch = /\.([a-z0-9]{1,12})$/i.exec(trimmed);
  const extension = extensionMatch?.[1]?.toLowerCase();
  const stem = extension ? trimmed.slice(0, -(extension.length + 1)) : trimmed;
  const normalizedStem = normalizeSlug(stem);
  return normalizedStem ? `${normalizedStem}${extension ? `.${extension}` : ''}` : '';
};

export const isMachineSafeId = (value: string): boolean => MACHINE_SAFE_ID_RE.test(value);
export const isRequestId = (value: string): boolean => REQUEST_ID_RE.test(value);
export const isTemplateId = (value: string): boolean => TEMPLATE_ID_RE.test(value);
export const isSlot = (value: string): boolean => {
  if (value.startsWith('img_')) return IMAGE_SLOT_RE.test(value) && !/_\d$/.test(value);
  if (value.startsWith('pdf_') || value.startsWith('download_')) return PDF_SLOT_RE.test(value);
  return GENERIC_SLOT_RE.test(value);
};
export const isSlug = (value: string): boolean => SLUG_RE.test(value);
export const isFilename = (value: string): boolean => FILENAME_RE.test(value);

export const normalizeLabel = (value: string): string => compact(value);
export const normalizeCtaLabel = (value: string): string => compact(value);

export const validateRequestId = (value: string): NamingValidationResult => {
  const normalized = normalizeMachineSafeId(value);
  if (!normalized) return { ok: false, error: 'request_id is required.' };
  if (!isRequestId(normalized)) {
    return { ok: false, error: 'request_id must match req_<flow>_<topic>_<yyyymmdd>_<nn> using lowercase snake_case.' };
  }
  return { ok: true, value: normalized };
};

export const validateTemplateId = (value: string): NamingValidationResult => {
  const normalized = normalizeMachineSafeId(value);
  if (!normalized) return { ok: false, error: 'template_id is required.' };
  if (!isTemplateId(normalized)) {
    return {
      ok: false,
      error: 'template_id must match tpl_<project>_<purpose>_<variant>_v<version> using lowercase snake_case.',
    };
  }
  return { ok: true, value: normalized };
};

export const validateSlot = (value: string): NamingValidationResult => {
  const normalized = normalizeMachineSafeId(value);
  if (!normalized) return { ok: false, error: 'slot is required.' };
  if (!isSlot(normalized)) {
    return {
      ok: false,
      error:
        'slot must use pdf_<purpose>, download_<purpose>, img_<role>[_nn], or <kind>_<purpose> lowercase snake_case.',
    };
  }
  return { ok: true, value: normalized };
};

export const validateSlug = (value: string): NamingValidationResult => {
  const normalized = normalizeSlug(value);
  if (!normalized) return { ok: false, error: 'slug is required.' };
  if (!isSlug(normalized)) return { ok: false, error: 'slug must be lowercase kebab-case.' };
  return { ok: true, value: normalized };
};

export const validateFilename = (value: string): NamingValidationResult => {
  const normalized = normalizeFilename(value);
  if (!normalized) return { ok: false, error: 'filename is required.' };
  if (!isFilename(normalized))
    return { ok: false, error: 'filename must be readable lowercase kebab-case with an optional extension.' };
  return { ok: true, value: normalized };
};
