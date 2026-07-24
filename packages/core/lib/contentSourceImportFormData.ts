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
  const title = normalizeTextImportField(contentSource, [['content', 'title']]);
  const slug = { exists: false, value: '' };
  const computedSlug = slugify(slug.value || title.value);
  const author = { exists: false, value: '' };
  const excerpt = normalizeTextImportField(contentSource, [['content', 'deck']]);
  const seoDescription = normalizeTextImportField(contentSource, [['seo', 'meta_description']]);
  const markdown = getContentSourceMarkdown(contentSource);
  const content = {
    exists: Boolean(markdown),
    value: markdown,
  };
  const importedTags = getFirstImportPathValue(contentSource, [['taxonomy', 'tags']]);
  const importedSources = getPathValue(contentSource, ['sources', 'source_list']);
  const featuredImage = { exists: false, value: '' };
  const existingFeaturedImagePath = { exists: false, value: '' };
  const uploadedImageNames: { exists: boolean; value: unknown } = { exists: false, value: undefined };
  const artifactReferences: { exists: boolean; value: unknown } = { exists: false, value: undefined };
  const mediaEntries: { exists: boolean; value: unknown } = { exists: false, value: undefined };
  const articleBody = getFirstImportPathValue(contentSource, [['content', 'article_body'], ['article_body']]);

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
    featuredImage,
    existingFeaturedImagePath,
    imageNames: {
      exists: uploadedImageNames.exists,
      value: Array.isArray(uploadedImageNames.value)
        ? uploadedImageNames.value.map((name) => (typeof name === 'string' ? name.trim() : '')).filter(Boolean)
        : [],
    },
    artifactReferences: {
      exists: artifactReferences.exists,
      value: Array.isArray(artifactReferences.value) ? artifactReferences.value : [],
    },
    mediaEntries: {
      exists: mediaEntries.exists,
      value: Array.isArray(mediaEntries.value) ? mediaEntries.value : [],
    },
    articleBody: {
      exists: articleBody.exists,
      value: articleBody.value,
    },
  };
};
