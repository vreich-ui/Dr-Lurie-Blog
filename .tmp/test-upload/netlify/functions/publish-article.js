import { timingSafeEqual } from 'node:crypto';
import { getAdminStateFromEvent, getHeader } from '../lib/admin-auth.js';
import { normalizeArtifactBlobKey, reconcileArtifactReference, requireArtifactReferenceArray, } from '../lib/artifacts.js';
import { getArtifactBlobStore, getArtifactIndexBlobStore } from '../lib/blob-store.js';
import { ImageValidationError, validatePublishImageBytes } from '../lib/image-validation.js';
import { getDeployReceiptByCommit, isNetlifyDeployLookupConfigured, pollDeployReceipt, } from '../lib/netlify-deploys.js';
import { publishPayloadSchema } from '../../src/schema/schema-v1.js';
const jsonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
};
const repoContentRoot = 'src/data/post';
const uploadRoot = 'src/assets/images/uploads';
const githubApiRoot = 'https://api.github.com';
const DEFAULT_DEPLOY_WAIT_TIMEOUT_SECONDS = 120;
const DEFAULT_DEPLOY_POLL_INTERVAL_SECONDS = 5;
const MAX_DEPLOY_WAIT_TIMEOUT_SECONDS = 120;
const MIN_DEPLOY_POLL_INTERVAL_SECONDS = 1;
const MAX_DEPLOY_POLL_INTERVAL_SECONDS = 30;
const clampNumber = (value, min, max) => Math.min(Math.max(value, min), max);
const parseBoundedNumber = (value, defaultValue, min, max) => {
    if (value === undefined || value === null || value === '')
        return defaultValue;
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN;
    if (!Number.isFinite(parsed))
        return defaultValue;
    return clampNumber(parsed, min, max);
};
const getPublishDeployReceipt = async (input, commit) => {
    const fallbackReceipt = {
        commit,
        deployStatus: 'queued',
    };
    if (!isNetlifyDeployLookupConfigured())
        return fallbackReceipt;
    try {
        if (!toBooleanValue(input.waitForDeploy)) {
            const receipt = await getDeployReceiptByCommit(commit);
            return receipt ? { ...fallbackReceipt, ...receipt } : fallbackReceipt;
        }
        const timeoutSeconds = parseBoundedNumber(input.deployWaitTimeoutSeconds, DEFAULT_DEPLOY_WAIT_TIMEOUT_SECONDS, 0, MAX_DEPLOY_WAIT_TIMEOUT_SECONDS);
        const intervalSeconds = parseBoundedNumber(input.deployPollIntervalSeconds, DEFAULT_DEPLOY_POLL_INTERVAL_SECONDS, MIN_DEPLOY_POLL_INTERVAL_SECONDS, MAX_DEPLOY_POLL_INTERVAL_SECONDS);
        const receipt = await pollDeployReceipt({ commit, timeoutSeconds, intervalSeconds });
        return { ...fallbackReceipt, ...receipt };
    }
    catch (error) {
        console.warn('Netlify deploy receipt lookup failed after publish.', { commit, error });
        return fallbackReceipt;
    }
};
class PublishError extends Error {
    statusCode;
    constructor(statusCode, message) {
        super(message);
        this.name = 'PublishError';
        this.statusCode = statusCode;
    }
}
const toStringValue = (value) => {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};
const slugify = (value) => value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const sanitizeFilename = (value) => {
    const normalized = value
        .split(/[\\/]/)
        .pop()
        ?.toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || undefined;
};
const escapeYaml = (value) => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
const toBooleanValue = (value) => value === true || value === 'true' || value === 'on';
const secretsMatch = (provided, expected) => {
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);
    if (providedBuffer.length !== expectedBuffer.length)
        return false;
    return timingSafeEqual(providedBuffer, expectedBuffer);
};
const normalizeRepoPath = (value) => {
    if (value.startsWith('/') || value.includes('\\'))
        return undefined;
    const normalized = value.split('/').reduce((parts, part) => {
        if (!part || part === '.')
            return parts;
        if (part === '..') {
            parts.pop();
            return parts;
        }
        parts.push(part);
        return parts;
    }, []);
    const path = normalized.join('/');
    return path === value && !path.startsWith('../') ? path : undefined;
};
const isExpectedArticlePath = (path, slug) => path === `${repoContentRoot}/${slug}.md`;
const isValidUploadedImagePath = (path) => {
    const prefix = `${uploadRoot}/`;
    return path.startsWith(prefix) && path.length > prefix.length && !path.endsWith('/');
};
const isValidImagePath = (path, slug) => {
    const prefix = `${uploadRoot}/${slug}/`;
    return isValidUploadedImagePath(path) && path.startsWith(prefix) && path.length > prefix.length;
};
const toSafeLogPath = (value) => value
    ?.split('')
    .filter((character) => {
    const code = character.charCodeAt(0);
    return code >= 32 && code !== 127;
})
    .join('')
    .slice(0, 240);
const getPublishRequestId = (event, input) => event.requestId ?? toStringValue(input.requestId) ?? toStringValue(input.request_id) ?? null;
const logPublishMedia = (event, input, logEvent, slug, articlePath, details = {}) => {
    event.log?.({
        event: logEvent,
        requestId: getPublishRequestId(event, input),
        rpcMethod: event.rpcMethod ?? null,
        slug,
        articlePath,
        ...details,
    });
};
const isHttpImageReference = (value) => {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:';
    }
    catch {
        return false;
    }
};
const extensionForContentType = (contentType) => {
    const normalized = contentType.toLowerCase().split(';')[0]?.trim();
    const extensionMap = {
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/svg+xml': '.svg',
        'audio/mpeg': '.mp3',
        'audio/mp3': '.mp3',
        'audio/wav': '.wav',
        'video/mp4': '.mp4',
        'text/markdown': '.md',
    };
    return normalized ? (extensionMap[normalized] ?? '.bin') : '.bin';
};
const getArtifactRequestId = (reference, fallback) => {
    const metadataRequestId = toStringValue(reference.metadata?.requestId);
    if (metadataRequestId)
        return metadataRequestId;
    const [, requestId] = reference.blobKey.split('/');
    return requestId || fallback;
};
const getArtifactFilename = (reference, fallbackRequestId) => {
    const originalFilename = toStringValue(reference.originalFilename);
    const metadataFilename = toStringValue(reference.metadata?.filename) ??
        toStringValue(reference.metadata?.name) ??
        (originalFilename && originalFilename.includes('.') ? originalFilename : undefined);
    const filename = metadataFilename ? sanitizeFilename(metadataFilename) : undefined;
    if (filename)
        return filename;
    const requestId = sanitizeFilename(getArtifactRequestId(reference, fallbackRequestId)) ?? fallbackRequestId;
    const derivedFilename = sanitizeFilename(`${requestId}-${reference.sha256}${extensionForContentType(reference.contentType)}`);
    if (!derivedFilename) {
        throw new PublishError(400, `Artifact reference has an invalid sha256: ${reference.sha256}`);
    }
    return derivedFilename;
};
const getArtifactTargetPath = (reference) => toStringValue(reference.repoPath) ?? toStringValue(reference.metadata?.repoPath);
const normalizeUploadReferencePath = (value) => {
    const repoPath = value.startsWith('~/assets/images/uploads/')
        ? value.replace('~/assets/images/uploads/', `${uploadRoot}/`)
        : value.startsWith('/src/assets/images/uploads/')
            ? value.slice(1)
            : value.startsWith(`${uploadRoot}/`)
                ? value
                : undefined;
    const normalizedPath = repoPath ? normalizeRepoPath(repoPath) : undefined;
    return normalizedPath && isValidUploadedImagePath(normalizedPath) ? normalizedPath : undefined;
};
const getDisplayPath = (path) => path.startsWith(`${uploadRoot}/`) ? path.replace(`${uploadRoot}/`, '~/assets/images/uploads/') : path;
const replaceAllLiteral = (value, search, replacement) => search ? value.split(search).join(replacement) : value;
const getArtifactReplacementValues = (reference) => [
    reference.blobKey,
    reference[originalArtifactBlobKey],
    toStringValue(reference.url),
].filter((value) => Boolean(value));
const getPublishedMediaDisplayPath = (mediaEntries, requestedPath) => {
    if (!requestedPath)
        return undefined;
    const selectedFilename = sanitizeFilename(requestedPath);
    return mediaEntries.find((entry) => {
        if (selectedFilename && entry.path.endsWith(`/${selectedFilename}`))
            return true;
        if (!entry.artifactReference)
            return false;
        return getArtifactReplacementValues(entry.artifactReference).includes(requestedPath);
    })?.displayPath;
};
const replacePublishedArtifactReferences = (markdown, mediaEntries) => mediaEntries.reduce((updatedMarkdown, entry) => {
    const reference = entry.artifactReference;
    if (!reference)
        return updatedMarkdown;
    const replacements = getArtifactReplacementValues(reference);
    return replacements.reduce((currentMarkdown, artifactPath) => replaceAllLiteral(currentMarkdown, artifactPath, entry.displayPath), updatedMarkdown);
}, markdown);
const originalArtifactBlobKey = Symbol('originalArtifactBlobKey');
const normalizeArtifactReferenceInputBlobKeys = (value) => {
    if (!Array.isArray(value))
        return value;
    return value.map((reference) => {
        if (!reference || typeof reference !== 'object' || Array.isArray(reference))
            return reference;
        const record = reference;
        if (typeof record.blobKey !== 'string')
            return reference;
        const normalizedBlobKey = normalizeArtifactBlobKey(record.blobKey);
        const normalizedReference = { ...record, blobKey: normalizedBlobKey };
        if (normalizedBlobKey !== record.blobKey) {
            Object.defineProperty(normalizedReference, originalArtifactBlobKey, { value: record.blobKey });
        }
        return normalizedReference;
    });
};
const normalizeArtifactReferences = (value) => {
    try {
        return requireArtifactReferenceArray(normalizeArtifactReferenceInputBlobKeys(value));
    }
    catch (error) {
        throw new PublishError(400, error instanceof Error ? error.message : 'Invalid artifactReferences.');
    }
};
const staleImageReferencesMessage = 'These saved image references exist in JSON, but the backing blob files are missing or unreadable.';
const readArtifactBytes = async (artifactStore, indexStore, reference, filename) => {
    const originalBlobKey = reference[originalArtifactBlobKey];
    const reconciliationReference = originalBlobKey ? { ...reference, blobKey: originalBlobKey } : reference;
    const reconciliation = await reconcileArtifactReference(reconciliationReference, artifactStore, indexStore, {
        logger: console,
    });
    if (reconciliation.status === 'found')
        return reconciliation.bytes;
    console.warn('Artifact image reference could not be reconciled during publish.', {
        blobKey: reference.blobKey,
        filename,
        status: reconciliation.status,
        ...(reconciliation.status === 'missing'
            ? { nearbyKeys: reconciliation.nearbyKeys, exactFilenameExists: reconciliation.exactFilenameExists }
            : { matchingKeys: reconciliation.matchingKeys, nearbyKeys: reconciliation.nearbyKeys }),
    });
    throw new PublishError(422, staleImageReferencesMessage);
};
const hasFrontmatter = (markdown) => /^---(?:\s|$)/.test(markdown.trimStart());
const getPublishPayloadIssue = (input, slug, title, publishDate, tags) => {
    const result = publishPayloadSchema.safeParse({
        slug,
        title,
        markdown: toStringValue(input.markdown),
        content: toStringValue(input.content),
        description: toStringValue(input.description),
        publishDate,
        author: toStringValue(input.author),
        tags,
        images: Array.isArray(input.images) ? input.images : undefined,
        mediaEntries: Array.isArray(input.mediaEntries) ? input.mediaEntries : undefined,
        artifactReferences: Array.isArray(input.artifactReferences) ? input.artifactReferences : undefined,
        overwrite: toBooleanValue(input.overwrite),
        draft: toBooleanValue(input.draft),
        articlePath: toStringValue(input.articlePath),
        category: toStringValue(input.category),
        excerpt: toStringValue(input.excerpt),
        seoDescription: toStringValue(input.seoDescription),
        featuredImage: toStringValue(input.featuredImage),
        existingFeaturedImagePath: toStringValue(input.existingFeaturedImagePath),
        videoLink: toStringValue(input.videoLink),
        ctaLink: toStringValue(input.ctaLink),
        ctaText: toStringValue(input.ctaText),
        commitMessage: toStringValue(input.commitMessage),
        metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
            ? input.metadata
            : undefined,
    });
    if (result.success)
        return undefined;
    return result.error.issues.map((issue) => `${issue.path.join('.') || 'publishPayload'}: ${issue.message}`).join('; ');
};
const parseTags = (value) => {
    if (Array.isArray(value)) {
        return value.map((tag) => toStringValue(tag)).filter((tag) => Boolean(tag));
    }
    const tags = toStringValue(value);
    return tags
        ? tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean)
        : [];
};
const verifyPublisher = async (event) => {
    const publishKey = getHeader(event.headers, 'x-publish-key').trim();
    if (publishKey) {
        const publishSecret = process.env.PUBLISH_SECRET || process.env.NETLIFY_PUBLISH_SECRET;
        if (!publishSecret) {
            return jsonResponse(401, {
                error: 'Service publishing is not configured on the server.',
            });
        }
        if (secretsMatch(publishKey, publishSecret)) {
            return undefined;
        }
        console.warn('Rejected publish request with invalid x-publish-key. Falling back to Clerk auth.');
    }
    const adminState = await getAdminStateFromEvent(event);
    if (!adminState.authenticated) {
        const statusCode = adminState.error === 'Clerk authentication is not configured.' ? 500 : 401;
        const error = adminState.error === 'A valid Clerk session token is required.'
            ? 'A valid x-publish-key header or Clerk session token is required to publish articles.'
            : adminState.error || 'A valid x-publish-key header or Clerk session token is required to publish articles.';
        return jsonResponse(statusCode, { error });
    }
    if (!adminState.isAdmin) {
        return jsonResponse(403, { error: 'This Clerk user is not authorized to publish articles.' });
    }
    return undefined;
};
const parseBody = (event) => {
    if (!event.body)
        return undefined;
    const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    const contentType = getHeader(event.headers, 'content-type');
    if (contentType.includes('application/json')) {
        const parsed = JSON.parse(body);
        return parsed && typeof parsed === 'object' ? parsed : undefined;
    }
    if (contentType.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(body);
        return Object.fromEntries(params.entries());
    }
    return undefined;
};
const buildFrontmatter = ({ author, category, content, ctaLink, ctaText, draft, excerpt, imagePath, publishDate, seoDescription, tags, title, videoLink, }) => {
    const lines = [
        '---',
        `publishDate: ${publishDate}`,
        `title: "${escapeYaml(title)}"`,
        ...(draft ? ['draft: true'] : []),
        ...(excerpt ? [`excerpt: "${escapeYaml(excerpt)}"`] : []),
        ...(imagePath ? [`image: "${escapeYaml(imagePath)}"`] : []),
        ...(videoLink ? [`video: "${escapeYaml(videoLink)}"`] : []),
        ...(ctaLink ? [`ctaLink: "${escapeYaml(ctaLink)}"`] : []),
        ...(ctaText ? [`ctaText: "${escapeYaml(ctaText)}"`] : []),
        ...(category ? [`category: "${escapeYaml(category)}"`] : []),
        ...(tags.length ? ['tags:', ...tags.map((tag) => `  - "${escapeYaml(tag)}"`)] : []),
        ...(author ? [`author: "${escapeYaml(author)}"`] : []),
        ...(seoDescription ? ['metadata:', `  description: "${escapeYaml(seoDescription)}"`] : []),
        '---',
        '',
    ];
    return `${lines.join('\n')}${content.trim()}\n`;
};
const githubRequest = async (path, token, init = {}) => {
    const response = await fetch(`${githubApiRoot}${path}`, {
        ...init,
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'dr-lurie-netlify-publisher',
            'X-GitHub-Api-Version': '2022-11-28',
            ...init.headers,
        },
    });
    if (!response.ok) {
        const body = await response.text();
        throw new PublishError(response.status === 401 || response.status === 403 ? 403 : 500, `GitHub API ${response.status} for ${path}: ${body}`);
    }
    return (await response.json());
};
const githubExists = async (repo, branch, path, token) => {
    const response = await fetch(`${githubApiRoot}/repos/${repo}/contents/${encodeURIComponent(path).replaceAll('%2F', '/')}?ref=${encodeURIComponent(branch)}`, {
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'User-Agent': 'dr-lurie-netlify-publisher',
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });
    if (response.status === 404)
        return false;
    if (response.ok)
        return true;
    const body = await response.text();
    throw new PublishError(response.status === 401 || response.status === 403 ? 403 : 500, `GitHub API ${response.status} while checking ${path}: ${body}`);
};
const readGitHubContentBytes = async ({ repo, branch, token }, path) => {
    const response = await fetch(`${githubApiRoot}/repos/${repo}/contents/${encodeURIComponent(path).replaceAll('%2F', '/')}?ref=${encodeURIComponent(branch)}`, {
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'User-Agent': 'dr-lurie-netlify-publisher',
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });
    if (response.status === 404) {
        throw new PublishError(422, `Image reference does not exist: ${path}. Re-select or re-upload this image.`);
    }
    if (!response.ok) {
        const body = await response.text();
        throw new PublishError(response.status === 401 || response.status === 403 ? 403 : 500, `GitHub API ${response.status} while reading image reference ${path}: ${body}`);
    }
    const body = (await response.json());
    const content = toStringValue(body.content);
    const encoding = toStringValue(body.encoding);
    if (body.type && body.type !== 'file') {
        throw new PublishError(422, `Image reference is not a file: ${path}. Re-select or re-upload this image.`);
    }
    if (!content || encoding !== 'base64') {
        throw new PublishError(422, `Image reference could not be read: ${path}. Re-select or re-upload this image.`);
    }
    return Buffer.from(content.replace(/\s/g, ''), 'base64');
};
const readExternalImageBytes = async (url) => {
    const response = await fetch(url, {
        headers: {
            Accept: 'image/jpeg,image/png,image/webp',
            'User-Agent': 'dr-lurie-netlify-publisher',
        },
    });
    if (!response.ok) {
        throw new PublishError(422, `External image reference could not be read: ${url}. Re-select or re-upload this image.`);
    }
    return {
        bytes: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') ?? undefined,
    };
};
const resolveExistingImageReference = async (value, githubContext, fallbackContentType) => {
    if (isHttpImageReference(value)) {
        const { bytes, contentType } = await readExternalImageBytes(value);
        const filename = sanitizeFilename(new URL(value).pathname) ?? value;
        return {
            content: '',
            contentType: fallbackContentType ?? contentType,
            displayPath: value,
            encoding: 'base64',
            filename,
            path: value,
            persist: false,
            rawBytes: bytes,
        };
    }
    const path = normalizeUploadReferencePath(value);
    if (!path) {
        throw new PublishError(403, `Image references must be under ${uploadRoot}/ or be an HTTP(S) image URL.`);
    }
    const bytes = await readGitHubContentBytes(githubContext, path);
    return {
        content: '',
        contentType: fallbackContentType,
        displayPath: getDisplayPath(path),
        encoding: 'base64',
        filename: sanitizeFilename(path),
        path,
        persist: false,
        rawBytes: bytes,
    };
};
const jsonResponse = (statusCode, body) => ({
    statusCode,
    headers: jsonHeaders,
    body: JSON.stringify(body),
});
const decodeMediaEntryBytes = (content, encoding, path) => {
    try {
        return Buffer.from(content, encoding === 'base64' ? 'base64' : 'utf8');
    }
    catch {
        throw new PublishError(422, `Invalid image artifact: ${path} could not be decoded. Re-upload or replace this image.`);
    }
};
const validateMediaEntries = async (mediaEntries) => {
    for (const entry of mediaEntries) {
        await validatePublishImageBytes({
            bytes: entry.rawBytes,
            contentType: entry.contentType,
            filename: entry.filename,
            path: entry.path,
        });
    }
};
const getMediaEntries = async (event, input, slug, articlePath, artifactReferences, githubContext) => {
    const files = Array.isArray(input.files) ? input.files : [];
    const uploadedFiles = files
        .map((file) => ({
        base64: toStringValue(file.base64),
        name: toStringValue(file.name),
        type: toStringValue(file.type),
    }))
        .filter((file) => Boolean(file.base64 && file.name));
    const adminEntries = uploadedFiles.map((file) => {
        const filename = sanitizeFilename(file.name);
        if (!filename) {
            throw new PublishError(400, `Invalid upload filename: ${file.name}`);
        }
        return {
            content: file.base64,
            contentType: file.type,
            displayPath: `~/assets/images/uploads/${slug}/${filename}`,
            encoding: 'base64',
            filename,
            path: `${uploadRoot}/${slug}/${filename}`,
            rawBytes: decodeMediaEntryBytes(file.base64, 'base64', `${uploadRoot}/${slug}/${filename}`),
        };
    });
    const fallbackRequestId = toStringValue(input.requestId) ?? slug;
    const artifactTargetPaths = new Map();
    const images = Array.isArray(input.images) ? input.images : [];
    const agentImageSummaries = images.map((image) => {
        const repoPath = toStringValue(image.repoPath);
        const filename = toStringValue(image.name);
        const normalizedPath = repoPath ? normalizeRepoPath(repoPath) : undefined;
        const path = normalizedPath ?? (filename ? `${uploadRoot}/${slug}/${sanitizeFilename(filename) ?? ''}` : undefined);
        return {
            imagePath: toSafeLogPath(repoPath ?? filename),
            repoPath: toSafeLogPath(path),
            hasContent: Boolean(toStringValue(image.base64) ?? toStringValue(image.content)),
        };
    });
    logPublishMedia(event, input, 'publish_media_entries_started', slug, articlePath, {
        imagePaths: agentImageSummaries.map((image) => image.imagePath ?? null),
        repoPaths: agentImageSummaries.map((image) => image.repoPath ?? null),
        images: agentImageSummaries,
        mediaEntryInputCount: Array.isArray(input.mediaEntries) ? input.mediaEntries.length : 0,
        artifactReferenceCount: artifactReferences.length,
    });
    const agentEntries = [];
    for (const image of images) {
        const repoPath = toStringValue(image.repoPath);
        const filename = toStringValue(image.name);
        const normalizedPath = repoPath ? normalizeRepoPath(repoPath) : undefined;
        const path = normalizedPath ?? (filename ? `${uploadRoot}/${slug}/${sanitizeFilename(filename) ?? ''}` : undefined);
        const content = toStringValue(image.base64) ?? toStringValue(image.content);
        if (!content) {
            const referenceValue = repoPath ?? filename;
            if (!referenceValue) {
                logPublishMedia(event, input, 'publish_media_image_missing_content', slug, articlePath, {
                    imagePath: null,
                    repoPath: toSafeLogPath(path),
                });
                throw new PublishError(400, 'Image content or a valid image reference is required for an image entry.');
            }
            const existingPath = normalizeUploadReferencePath(referenceValue);
            const matchingArtifact = existingPath
                ? artifactReferences.find((reference) => !artifactTargetPaths.has(reference) &&
                    sanitizeFilename(existingPath) === getArtifactFilename(reference, fallbackRequestId))
                : undefined;
            if (existingPath && matchingArtifact && isValidImagePath(existingPath, slug)) {
                artifactTargetPaths.set(matchingArtifact, existingPath);
                continue;
            }
            agentEntries.push(await resolveExistingImageReference(referenceValue, githubContext, toStringValue(image.type)));
            continue;
        }
        if (!path || !isValidImagePath(path, slug)) {
            const safeRepoPath = toSafeLogPath(path ?? repoPath ?? filename);
            logPublishMedia(event, input, 'publish_media_invalid_image_repo_path', slug, articlePath, {
                repoPath: safeRepoPath,
            });
            throw new PublishError(403, `Image repoPath values must be under ${uploadRoot}/${slug}/ and include a filename. Received: ${safeRepoPath ?? '(missing)'}.`);
        }
        agentEntries.push({
            content,
            contentType: toStringValue(image.type),
            displayPath: getDisplayPath(path),
            encoding: toStringValue(image.encoding) === 'utf-8' ? 'utf-8' : 'base64',
            filename: sanitizeFilename(filename ?? path),
            path,
            rawBytes: decodeMediaEntryBytes(content, toStringValue(image.encoding) === 'utf-8' ? 'utf-8' : 'base64', path),
        });
    }
    const mediaEntryInputs = Array.isArray(input.mediaEntries) ? input.mediaEntries : [];
    const directMediaEntries = mediaEntryInputs.map((entry) => {
        const repoPath = toStringValue(entry.repoPath) ?? toStringValue(entry.path);
        const filename = toStringValue(entry.name);
        const normalizedPath = repoPath ? normalizeRepoPath(repoPath) : undefined;
        const path = normalizedPath ?? (filename ? `${uploadRoot}/${slug}/${sanitizeFilename(filename) ?? ''}` : undefined);
        if (!path || !isValidImagePath(path, slug)) {
            const safeRepoPath = toSafeLogPath(path ?? repoPath ?? filename);
            logPublishMedia(event, input, 'publish_media_invalid_media_entry_repo_path', slug, articlePath, {
                repoPath: safeRepoPath,
            });
            throw new PublishError(403, `mediaEntries repoPath/path values must be under ${uploadRoot}/${slug}/ and include a filename. Received: ${safeRepoPath ?? '(missing)'}.`);
        }
        const content = toStringValue(entry.base64) ?? toStringValue(entry.content);
        if (!content) {
            const safeRepoPath = toSafeLogPath(path);
            logPublishMedia(event, input, 'publish_media_entry_missing_content', slug, articlePath, {
                repoPath: safeRepoPath,
            });
            throw new PublishError(400, `Media entry content is required for ${safeRepoPath}.`);
        }
        return {
            content,
            contentType: toStringValue(entry.type),
            displayPath: getDisplayPath(path),
            encoding: toStringValue(entry.encoding) === 'utf-8' ? 'utf-8' : 'base64',
            filename: sanitizeFilename(filename ?? path),
            path,
            rawBytes: decodeMediaEntryBytes(content, toStringValue(entry.encoding) === 'utf-8' ? 'utf-8' : 'base64', path),
        };
    });
    const artifactStore = artifactReferences.length ? await getArtifactBlobStore(event) : undefined;
    const indexStore = artifactReferences.length ? await getArtifactIndexBlobStore(event) : undefined;
    const artifactEntries = await Promise.all(artifactReferences.map(async (reference) => {
        if (!artifactStore) {
            throw new PublishError(500, 'Artifact blob store is not available.');
        }
        const explicitTargetPath = getArtifactTargetPath(reference);
        const normalizedTargetPath = explicitTargetPath ? normalizeUploadReferencePath(explicitTargetPath) : undefined;
        const path = artifactTargetPaths.get(reference) ?? normalizedTargetPath;
        if (explicitTargetPath && (!path || !isValidImagePath(path, slug))) {
            const safeRepoPath = toSafeLogPath(path ?? explicitTargetPath);
            logPublishMedia(event, input, 'publish_media_invalid_artifact_repo_path', slug, articlePath, {
                repoPath: safeRepoPath,
            });
            throw new PublishError(403, `Artifact repoPath values must be under ${uploadRoot}/${slug}/ and include a filename. Received: ${safeRepoPath ?? '(missing)'}.`);
        }
        const filename = path
            ? (sanitizeFilename(path) ?? getArtifactFilename(reference, fallbackRequestId))
            : getArtifactFilename(reference, fallbackRequestId);
        if (!indexStore) {
            throw new PublishError(500, 'Artifact index blob store is not available.');
        }
        const bytes = await readArtifactBytes(artifactStore, indexStore, reference, filename);
        return {
            artifactReference: reference,
            content: bytes.toString('base64'),
            contentType: reference.contentType,
            displayPath: path ? getDisplayPath(path) : `~/assets/images/uploads/${slug}/${filename}`,
            encoding: 'base64',
            filename,
            path: path ?? `${uploadRoot}/${slug}/${filename}`,
            rawBytes: bytes,
        };
    }));
    const mediaEntries = [...adminEntries, ...agentEntries, ...directMediaEntries, ...artifactEntries];
    logPublishMedia(event, input, 'publish_media_entries_resolved', slug, articlePath, {
        imagePaths: agentImageSummaries.map((image) => image.imagePath ?? null),
        repoPaths: mediaEntries.map((entry) => toSafeLogPath(entry.path) ?? null),
        images: agentImageSummaries,
        totalMediaEntries: mediaEntries.length,
    });
    return mediaEntries;
};
export const handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return jsonResponse(405, { error: 'Method not allowed' });
    }
    const authResponse = await verifyPublisher(event);
    if (authResponse) {
        return authResponse;
    }
    let input;
    try {
        input = parseBody(event);
    }
    catch {
        return jsonResponse(400, {
            error: 'Invalid request body. Send JSON from the publishing form or Agent Builder.',
        });
    }
    if (!input) {
        return jsonResponse(400, { error: 'Missing request body.' });
    }
    if (Object.hasOwn(input, 'publishedDate')) {
        return jsonResponse(400, { error: 'publishedDate is not supported. Use publishDate in PublishPayload.' });
    }
    const rawSlug = toStringValue(input.slug);
    const slug = rawSlug ? slugify(rawSlug) : undefined;
    const markdownInput = toStringValue(input.markdown);
    const content = toStringValue(input.content);
    const title = toStringValue(input.title);
    const publishDate = toStringValue(input.publishDate) ?? new Date().toISOString();
    const isAgentPayload = Boolean(markdownInput || input.articlePath || input.images || input.commitMessage);
    const missing = [
        !slug ? 'slug' : undefined,
        !markdownInput && !content ? (isAgentPayload ? 'markdown' : 'content') : undefined,
        !markdownInput && !isAgentPayload && !title ? 'title' : undefined,
        !isAgentPayload && !publishDate ? 'publishDate' : undefined,
    ].filter(Boolean);
    if (missing.length) {
        return jsonResponse(400, {
            error: `Missing required field${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`,
        });
    }
    if (Number.isNaN(Date.parse(publishDate))) {
        return jsonResponse(400, { error: 'publishDate must be a valid date string.' });
    }
    if ((markdownInput && hasFrontmatter(markdownInput)) || (content && hasFrontmatter(content))) {
        return jsonResponse(400, { error: 'Submit body-only markdown. Frontmatter is generated server-side.' });
    }
    if (!title) {
        return jsonResponse(400, { error: 'Missing required field: title' });
    }
    const tags = parseTags(input.tags);
    const publishPayloadIssue = slug ? getPublishPayloadIssue(input, slug, title, publishDate, tags) : undefined;
    if (publishPayloadIssue) {
        return jsonResponse(400, { error: `Invalid PublishPayload: ${publishPayloadIssue}` });
    }
    const rawArticlePath = toStringValue(input.articlePath) ?? `${repoContentRoot}/${slug}.md`;
    const articlePath = normalizeRepoPath(rawArticlePath);
    if (!slug || !articlePath || !isExpectedArticlePath(articlePath, slug)) {
        return jsonResponse(403, {
            error: `articlePath must be ${repoContentRoot}/{slug}.md.`,
            articlePath: rawArticlePath,
        });
    }
    const token = process.env.GITHUB_CONTENT_TOKEN;
    const repo = process.env.GITHUB_REPOSITORY;
    const branch = process.env.GITHUB_BRANCH ?? process.env.BRANCH ?? 'main';
    if (!token || !repo) {
        return jsonResponse(500, {
            error: 'Publishing is not configured. Set GITHUB_CONTENT_TOKEN and GITHUB_REPOSITORY in Netlify.',
        });
    }
    const overwrite = input.overwrite === true || input.overwrite === 'true';
    let artifactReferences;
    try {
        artifactReferences = normalizeArtifactReferences(input.artifactReferences);
    }
    catch (error) {
        if (error instanceof PublishError)
            return jsonResponse(error.statusCode, { error: error.message });
        return jsonResponse(400, { error: 'Invalid artifactReferences.' });
    }
    let publishImagePaths = [];
    try {
        const duplicateArticle = await githubExists(repo, branch, articlePath, token);
        if (duplicateArticle && !overwrite) {
            return jsonResponse(409, {
                error: `An article already exists at ${articlePath}. Enable overwrite to replace it.`,
                articlePath,
                path: articlePath,
            });
        }
        const githubContext = { branch, repo, token };
        const mediaEntries = await getMediaEntries(event, input, slug, articlePath, artifactReferences, githubContext);
        const featuredImage = toStringValue(input.featuredImage);
        const existingFeaturedImageInput = toStringValue(input.existingFeaturedImagePath);
        const uploadedImagePath = getPublishedMediaDisplayPath(mediaEntries, featuredImage) ??
            getPublishedMediaDisplayPath(mediaEntries, existingFeaturedImageInput);
        const existingFeaturedImage = uploadedImagePath
            ? undefined
            : existingFeaturedImageInput || featuredImage
                ? await resolveExistingImageReference(existingFeaturedImageInput ?? featuredImage ?? '', githubContext)
                : undefined;
        const entriesToValidate = existingFeaturedImage ? [...mediaEntries, existingFeaturedImage] : mediaEntries;
        await validateMediaEntries(entriesToValidate);
        publishImagePaths = entriesToValidate.map((entry) => entry.path);
        const imagePath = uploadedImagePath ?? existingFeaturedImage?.displayPath;
        const rawMarkdown = buildFrontmatter({
            author: toStringValue(input.author),
            category: toStringValue(input.category),
            content: markdownInput ?? content ?? '',
            ctaLink: toStringValue(input.ctaLink),
            ctaText: toStringValue(input.ctaText),
            draft: toBooleanValue(input.draft),
            excerpt: toStringValue(input.excerpt) ?? toStringValue(input.seoDescription),
            imagePath,
            publishDate,
            seoDescription: toStringValue(input.seoDescription),
            tags,
            title,
            videoLink: toStringValue(input.videoLink),
        });
        const markdown = replacePublishedArtifactReferences(rawMarkdown, mediaEntries);
        const ref = await githubRequest(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, token);
        const commit = await githubRequest(`/repos/${repo}/git/commits/${ref.object.sha}`, token);
        const markdownBlob = await githubRequest(`/repos/${repo}/git/blobs`, token, {
            method: 'POST',
            body: JSON.stringify({ content: markdown, encoding: 'utf-8' }),
        });
        const persistedMediaEntries = mediaEntries.filter((entry) => entry.persist !== false);
        const mediaBlobs = await Promise.all(persistedMediaEntries.map(async (entry) => ({
            ...entry,
            blob: await githubRequest(`/repos/${repo}/git/blobs`, token, {
                method: 'POST',
                body: JSON.stringify({ content: entry.content, encoding: entry.encoding }),
            }),
        })));
        const tree = await githubRequest(`/repos/${repo}/git/trees`, token, {
            method: 'POST',
            body: JSON.stringify({
                base_tree: commit.tree.sha,
                tree: [
                    { path: articlePath, mode: '100644', type: 'blob', sha: markdownBlob.sha },
                    ...mediaBlobs.map((entry) => ({
                        path: entry.path,
                        mode: '100644',
                        type: 'blob',
                        sha: entry.blob.sha,
                    })),
                ],
            }),
        });
        const authorName = process.env.GITHUB_COMMIT_AUTHOR_NAME ?? 'Dr. Lurié Publisher';
        const authorEmail = process.env.GITHUB_COMMIT_AUTHOR_EMAIL ?? 'publisher@drlurie.local';
        const author = { name: authorName, email: authorEmail };
        const commitMessage = toStringValue(input.commitMessage) ??
            `${overwrite && duplicateArticle ? 'Update' : 'Publish'} article: ${title ?? slug}`;
        const newCommit = await githubRequest(`/repos/${repo}/git/commits`, token, {
            method: 'POST',
            body: JSON.stringify({
                author,
                committer: author,
                message: commitMessage,
                parents: [ref.object.sha],
                tree: tree.sha,
            }),
        });
        await githubRequest(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, token, {
            method: 'PATCH',
            body: JSON.stringify({ force: false, sha: newCommit.sha }),
        });
        const deployReceipt = await getPublishDeployReceipt(input, newCommit.sha);
        const imagePaths = publishImagePaths;
        const message = `Article publish queued for ${articlePath}.`;
        return jsonResponse(201, {
            success: true,
            articlePath,
            imagePaths,
            deployId: deployReceipt.deployId,
            deployUrl: deployReceipt.deployUrl,
            productionUrl: deployReceipt.productionUrl,
            commit: deployReceipt.commit,
            deployStatus: deployReceipt.deployStatus,
            startedAt: deployReceipt.startedAt,
            finishedAt: deployReceipt.finishedAt,
            errorMessage: deployReceipt.errorMessage,
            message,
            media: imagePaths,
            ok: true,
            path: articlePath,
        });
    }
    catch (error) {
        console.error('Failed to publish article.', {
            articlePath,
            slug,
            imagePaths: publishImagePaths,
            error,
        });
        if (error instanceof PublishError) {
            return jsonResponse(error.statusCode, { error: error.message });
        }
        if (error instanceof ImageValidationError) {
            return jsonResponse(422, { error: error.message, path: error.path });
        }
        return jsonResponse(500, {
            error: error instanceof Error ? error.message : 'Article could not be published.',
        });
    }
};
