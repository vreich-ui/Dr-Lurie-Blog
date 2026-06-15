import { Buffer } from 'node:buffer';
import { getAdminStateFromEvent } from '../lib/admin-auth.js';
const jsonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
};
const repoContentRoot = 'src/data/post';
const githubApiRoot = 'https://api.github.com';
class EditArticleError extends Error {
    statusCode;
    constructor(statusCode, message) {
        super(message);
        this.name = 'EditArticleError';
        this.statusCode = statusCode;
    }
}
const jsonResponse = (statusCode, body) => ({
    statusCode,
    headers: jsonHeaders,
    body: JSON.stringify(body),
});
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
const parseScalar = (value) => {
    const trimmed = value.trim();
    const quoted = trimmed.match(/^['"](.*)['"]$/s);
    if (quoted)
        return quoted[1].replace(/\\([\\"])/g, '$1');
    if (trimmed === 'true')
        return true;
    if (trimmed === 'false')
        return false;
    if (trimmed === '[]')
        return [];
    return trimmed;
};
const parseFrontmatter = (markdown) => {
    const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
    if (!match)
        return { data: {}, content: markdown };
    const data = {};
    const lines = match[1].split('\n');
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (!pair)
            continue;
        const [, key, rawValue] = pair;
        if (rawValue === '') {
            const nested = {};
            const list = [];
            while (index + 1 < lines.length &&
                (/^\s+/.test(lines[index + 1]) || lines[index + 1].trimStart().startsWith('-'))) {
                index += 1;
                const child = lines[index].trim();
                const listItem = child.match(/^-\s*(.*)$/);
                const nestedPair = child.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
                if (listItem) {
                    list.push(parseScalar(listItem[1]));
                }
                else if (nestedPair) {
                    nested[nestedPair[1]] = parseScalar(nestedPair[2]);
                }
            }
            data[key] = list.length ? list : nested;
        }
        else {
            data[key] = parseScalar(rawValue);
        }
    }
    return {
        data,
        content: markdown.slice(match[0].length),
    };
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
const githubRequest = async (path, token) => {
    const response = await fetch(`${githubApiRoot}${path}`, {
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'User-Agent': 'dr-lurie-netlify-editor',
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });
    if (response.status === 404) {
        throw new EditArticleError(404, 'Article not found.');
    }
    if (!response.ok) {
        const body = await response.text();
        throw new EditArticleError(response.status === 401 || response.status === 403 ? 403 : 500, `GitHub API ${response.status} for ${path}: ${body}`);
    }
    return (await response.json());
};
export const handler = async (event) => {
    if (event.httpMethod !== 'GET') {
        return jsonResponse(405, { error: 'Method not allowed' });
    }
    const adminState = await getAdminStateFromEvent(event);
    if (!adminState.authenticated) {
        return jsonResponse(adminState.error === 'Clerk authentication is not configured.' ? 500 : 401, {
            error: adminState.error || 'A valid Clerk session token is required.',
        });
    }
    if (!adminState.isAdmin) {
        return jsonResponse(403, { error: 'This Clerk user is not authorized to edit articles.' });
    }
    const rawSlug = toStringValue(event.queryStringParameters?.slug);
    const slug = rawSlug ? slugify(rawSlug) : undefined;
    if (!slug) {
        return jsonResponse(400, { error: 'A valid slug query parameter is required.' });
    }
    const token = process.env.GITHUB_CONTENT_TOKEN;
    const repo = process.env.GITHUB_REPOSITORY;
    const branch = process.env.GITHUB_BRANCH ?? process.env.BRANCH ?? 'main';
    if (!token || !repo) {
        return jsonResponse(500, {
            error: 'Article editing is not configured. Set GITHUB_CONTENT_TOKEN and GITHUB_REPOSITORY in Netlify.',
        });
    }
    const articlePath = normalizeRepoPath(`${repoContentRoot}/${slug}.md`);
    if (!articlePath || !isExpectedArticlePath(articlePath, slug)) {
        return jsonResponse(403, { error: `slug must resolve to ${repoContentRoot}/{slug}.md.` });
    }
    try {
        const file = await githubRequest(`/repos/${repo}/contents/${encodeURIComponent(articlePath).replaceAll('%2F', '/')}?ref=${encodeURIComponent(branch)}`, token);
        if (!isExpectedArticlePath(file.path, slug)) {
            return jsonResponse(403, {
                error: `GitHub returned an unexpected path. Expected ${repoContentRoot}/${slug}.md.`,
                path: file.path,
            });
        }
        if (file.encoding !== 'base64' || !file.content) {
            return jsonResponse(500, { error: 'Article content could not be decoded.' });
        }
        const markdown = Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8');
        const { data, content } = parseFrontmatter(markdown);
        const metadata = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
        const image = toStringValue(data.image) ?? '';
        const video = toStringValue(data.video) ?? '';
        const description = toStringValue(metadata.description) ?? '';
        return jsonResponse(200, {
            article: {
                slug,
                title: toStringValue(data.title) ?? '',
                publishDate: toStringValue(data.publishDate) ?? '',
                excerpt: toStringValue(data.excerpt) ?? '',
                image,
                video,
                ctaLink: toStringValue(data.ctaLink) ?? '',
                ctaText: toStringValue(data.ctaText) ?? '',
                category: toStringValue(data.category) ?? '',
                tags: parseTags(data.tags),
                author: toStringValue(data.author) ?? '',
                draft: data.draft === true,
                metadata: {
                    description,
                },
                content,
                featuredImage: image,
                videoLink: video,
                seoDescription: description,
                markdown,
                articlePath,
            },
        });
    }
    catch (error) {
        console.error('Failed to load article for editing.', { articlePath, slug, error });
        if (error instanceof EditArticleError) {
            return jsonResponse(error.statusCode, { error: error.message });
        }
        return jsonResponse(500, {
            error: error instanceof Error ? error.message : 'Article could not be loaded for editing.',
        });
    }
};
