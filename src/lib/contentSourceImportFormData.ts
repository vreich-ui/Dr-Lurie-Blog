import { getContentSourceMarkdown } from './contentSourceBody.js';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const hasOwn = (object: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(object, key);

const getPathValue = (object: unknown, path: string[]) => {
  let current = object;

  for (const key of path) {
    if (!isPlainObject(current) || !hasOwn(current, key)) return { exists: false, value: undefined };
    current = current[key];
  }

  return { exists: true, value: current };
};

const getFirstImportPathValue = (object: unknown, paths: string[][]) => {
  for (const path of paths) {
    const result = getPathValue(object, path);
    if (result.exists) return result;
  }

  return { exists: false, value: undefined };
};

const normalizeTextImportField = (contentSource: unknown, paths: string[][]) => {
  const result = getFirstImportPathValue(contentSource, paths);
  return {
    exists: result.exists,
    value: result.exists && result.value != null ? result.value : '',
  };
};

const slugify = (value: unknown) =>
  String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const isSimpleImportObject = (value: unknown) =>
  Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.values(value).every((item) => item == null || ['string', 'number', 'boolean'].includes(typeof item))
  );

const formatImportedSource = (source: unknown) => {
  if (typeof source === 'string') return source.trim();
  if (!isSimpleImportObject(source)) return '';

  return Object.entries(source as Record<string, unknown>)
    .map(([key, value]) => {
      if (value == null || String(value).trim() === '') return '';
      return `${key}: ${String(value).trim()}`;
    })
    .filter(Boolean)
    .join('; ');
};

const formatImportedList = (value: unknown[]) => value.map(formatImportedSource).filter(Boolean).join('\n');

export const normalizeContentSourceImportToFormData = (
  contentSource: Record<string, unknown>,
  currentSchemaVersion: string
) => {
  const title = normalizeTextImportField(contentSource, [
    ['publication', 'publish_payload', 'title'],
    ['content', 'title'],
  ]);
  const slug = normalizeTextImportField(contentSource, [['publication', 'publish_payload', 'slug']]);
  const computedSlug = slugify(slug.value || title.value);
  const author = normalizeTextImportField(contentSource, [['publication', 'publish_payload', 'author']]);
  const excerpt = normalizeTextImportField(contentSource, [
    ['publication', 'publish_payload', 'excerpt'],
    ['publication', 'publish_payload', 'description'],
    ['content', 'deck'],
  ]);
  const seoDescription = normalizeTextImportField(contentSource, [
    ['publication', 'publish_payload', 'seoDescription'],
    ['seo', 'meta_description'],
    ['publication', 'publish_payload', 'description'],
  ]);
  const markdown = getContentSourceMarkdown(contentSource);
  const content = {
    exists: Boolean(markdown),
    value: markdown,
  };
  const importedTags = getFirstImportPathValue(contentSource, [
    ['publication', 'publish_payload', 'tags'],
    ['taxonomy', 'tags'],
  ]);
  const importedSources = getPathValue(contentSource, ['sources', 'source_list']);

  return {
    schemaVersion: contentSource.schema_version,
    currentSchemaVersion,
    title,
    slug: {
      exists: slug.exists || Boolean(computedSlug),
      value: computedSlug,
    },
    author,
    excerpt,
    seoDescription,
    content,
    tags: {
      exists: importedTags.exists,
      value: Array.isArray(importedTags.value)
        ? importedTags.value
            .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
            .filter(Boolean)
            .join(', ')
        : '',
    },
    sources: {
      exists: importedSources.exists,
      value: Array.isArray(importedSources.value) ? formatImportedList(importedSources.value) : '',
    },
  };
};
