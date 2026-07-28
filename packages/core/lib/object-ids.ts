import { validateRequestId, type NamingValidationResult } from './agents-naming.js';
import type { ObjectType } from '../schema/object-record-v1.js';

export type ObjectIdValidationResult = NamingValidationResult;

export const OBJECT_ID_CEILING_RE = /^(site|page|tpl|stpl|sec|nav|tax|thm|prod|req|trk|voice)_[a-z0-9_]+$/;
export const SECTION_INSTANCE_ID_RE = /^s_[a-z0-9]+$/;

const OBJECT_ID_PATTERNS = {
  site: /^site_[a-z0-9]+(?:_[a-z0-9]+)*$/,
  page: /^page_[a-z0-9]+(?:_[a-z0-9]+)*$/,
  section: /^sec_[a-z0-9]+(?:_[a-z0-9]+)*$/,
  navigation: /^nav_[a-z0-9]+(?:_[a-z0-9]+)*$/,
  taxonomy: /^tax_[a-z0-9]+(?:_[a-z0-9]+)*$/,
  template: /^tpl_[a-z0-9]+(?:_[a-z0-9]+)*$/,
  section_template: /^stpl_[a-z0-9]+(?:_[a-z0-9]+)*$/,
  theme: /^thm_[a-z0-9]+(?:_[a-z0-9]+)*$/,
  product: /^prod_[a-z0-9]+(?:_[a-z0-9]+)*$/,
  tracking_config: /^trk_[a-z0-9]+(?:_[a-z0-9]+)*$/,
  // D1: `voice_` spelled out rather than abbreviated — the id is read by agents
  // in contract output far more often than it is typed by a human.
  editorial_voice: /^voice_[a-z0-9]+(?:_[a-z0-9]+)*$/,
} satisfies Record<Exclude<ObjectType, 'content_item'>, RegExp>;

const OBJECT_TYPE_PREFIXES = {
  site: 'site_',
  page: 'page_',
  section: 'sec_',
  navigation: 'nav_',
  taxonomy: 'tax_',
  template: 'tpl_',
  section_template: 'stpl_',
  theme: 'thm_',
  product: 'prod_',
  content_item: 'req_',
  tracking_config: 'trk_',
  editorial_voice: 'voice_',
} satisfies Record<ObjectType, string>;

export const isObjectIdWithinCeiling = (value: string): boolean => OBJECT_ID_CEILING_RE.test(value);

const validatePattern = (value: string, objectType: Exclude<ObjectType, 'content_item'>): ObjectIdValidationResult => {
  const prefix = OBJECT_TYPE_PREFIXES[objectType];
  if (!value) return { ok: false, error: `${objectType} id is required.` };
  if (!OBJECT_ID_PATTERNS[objectType].test(value)) {
    return {
      ok: false,
      error: `${objectType} id must start with ${prefix} and use lowercase snake_case segments.`,
    };
  }
  return { ok: true, value };
};

export const validateObjectIdForType = (objectType: ObjectType, value: string): ObjectIdValidationResult => {
  if (objectType === 'content_item') return validateRequestId(value);
  return validatePattern(value, objectType);
};

export const isObjectIdForType = (objectType: ObjectType, value: string): boolean =>
  validateObjectIdForType(objectType, value).ok;

export const validateSectionInstanceId = (value: string): ObjectIdValidationResult => {
  if (!value) return { ok: false, error: 'section instance id is required.' };
  if (!SECTION_INSTANCE_ID_RE.test(value)) {
    return {
      ok: false,
      error: 'section instance id must match s_<lowercase-alphanumeric> with no underscores in the suffix.',
    };
  }
  return { ok: true, value };
};

export const isSectionInstanceId = (value: string): boolean => validateSectionInstanceId(value).ok;
