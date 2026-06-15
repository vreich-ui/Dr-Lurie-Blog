import { Buffer } from 'node:buffer';
import { getAdminStateFromEvent } from '../lib/admin-auth.js';
const jsonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
};
const repoContentRoot = 'src/data/post';
const githubApiRoot = 'https://api.github.com';
class DraftListError extends Error {
    statusCode;
    constructor(statusCode, message) {
        super(message);
        this.name = 'DraftListError';
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
    const quoted = trimmed.match(/^["'](.*)["']$/s);
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
        return {};
    const data = {};
    const lines = match[1].split('\n');
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (!pair)
            continue;
        const [, key, rawValue] = pair;
        if (rawValue === '') {
            const list = [];
            while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) {
                index += 1;
                const child = lines[index].trim();
                const listItem = child.match(/^-\s*(.*)$/);
                if (listItem)
                    list.push(parseScalar(listItem[1]));
            }
            data[key] = list;
        }
        else {
            data[key] = parseScalar(rawValue);
        }
    }
    return data;
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
const githubRequest = async (path, token) => {
    const response = await fetch(`${githubApiRoot}${path}`, {
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'User-Agent': 'dr-lurie-netlify-draft-list',
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });
    if (!response.ok) {
        const body = await response.text();
        throw new DraftListError(response.status === 401 || response.status === 403 ? 403 : 500, `GitHub API ${response.status} for ${path}: ${body}`);
    }
    return (await response.json());
};
const toDraftPost = (file) => {
    if (file.encoding !== 'base64' || !file.content || !file.name)
        return undefined;
    const markdown = Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8');
    const data = parseFrontmatter(markdown);
    if (data.draft !== true)
        return undefined;
    const slug = slugify(file.name.replace(/\.(md|mdx)$/i, ''));
    const title = toStringValue(data.title) ?? slug;
    const post = {
        slug,
        title,
        draft: true,
        publishDate: toStringValue(data.publishDate),
        excerpt: toStringValue(data.excerpt),
        category: toStringValue(data.category),
        tags: parseTags(data.tags),
        author: toStringValue(data.author),
    };
    return post;
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
        return jsonResponse(403, { error: 'This Clerk user is not authorized to view draft articles.' });
    }
    const token = process.env.GITHUB_CONTENT_TOKEN;
    const repo = process.env.GITHUB_REPOSITORY;
    const branch = process.env.GITHUB_BRANCH ?? process.env.BRANCH ?? 'main';
    if (!token || !repo) {
        return jsonResponse(500, {
            error: 'Draft article listing is not configured. Set GITHUB_CONTENT_TOKEN and GITHUB_REPOSITORY in Netlify.',
        });
    }
    try {
        const encodedRoot = encodeURIComponent(repoContentRoot).replaceAll('%2F', '/');
        const entries = await githubRequest(`/repos/${repo}/contents/${encodedRoot}?ref=${encodeURIComponent(branch)}`, token);
        const markdownEntries = entries.filter((entry) => entry.type === 'file' && entry.path?.startsWith(`${repoContentRoot}/`) && /\.(md|mdx)$/i.test(entry.name || ''));
        const files = await Promise.all(markdownEntries.map((entry) => githubRequest(`/repos/${repo}/contents/${encodeURIComponent(entry.path || '').replaceAll('%2F', '/')}?ref=${encodeURIComponent(branch)}`, token)));
        const posts = files
            .map(toDraftPost)
            .filter((post) => Boolean(post))
            .sort((a, b) => Date.parse(b.publishDate || '') - Date.parse(a.publishDate || ''));
        return jsonResponse(200, { ok: true, posts });
    }
    catch (error) {
        console.error('Failed to list draft articles.', { error });
        if (error instanceof DraftListError) {
            return jsonResponse(error.statusCode, { error: error.message });
        }
        return jsonResponse(500, {
            error: error instanceof Error ? error.message : 'Draft articles could not be loaded.',
        });
    }
};
