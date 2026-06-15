import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
const localBlobsRoot = join(process.cwd(), '.netlify', 'local-blobs');
const toPath = (storeName, key) => join(localBlobsRoot, storeName, key);
const toBlobKey = (storeRoot, filePath) => relative(storeRoot, filePath).split(sep).join('/');
const listFiles = async (current) => {
    try {
        const entries = await readdir(current, { withFileTypes: true });
        const files = await Promise.all(entries.map((entry) => {
            const entryPath = join(current, entry.name);
            return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
        }));
        return files.flat();
    }
    catch (error) {
        if (error &&
            typeof error === 'object' &&
            'code' in error &&
            (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
            return [];
        }
        throw error;
    }
};
export const createLocalBlobStore = (storeName) => {
    const storeRoot = join(localBlobsRoot, storeName);
    const getBlob = async (key, options) => {
        try {
            if (options?.type === 'buffer') {
                return await readFile(toPath(storeName, key));
            }
            if (options?.type === 'arrayBuffer') {
                const bytes = await readFile(toPath(storeName, key));
                return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            }
            return await readFile(toPath(storeName, key), 'utf8');
        }
        catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
                return null;
            }
            throw error;
        }
    };
    return {
        async set(key, value) {
            const filePath = toPath(storeName, key);
            await mkdir(dirname(filePath), { recursive: true });
            await writeFile(filePath, typeof value === 'string' ? value : new Uint8Array(value));
        },
        get: getBlob,
        async del(key) {
            await rm(toPath(storeName, key), { force: true });
        },
        async setJSON(key, value) {
            await this.set(key, JSON.stringify(value, null, 2));
        },
        async list(options) {
            const prefix = options?.prefix ?? '';
            const files = await listFiles(join(storeRoot, prefix));
            return {
                blobs: files.map((filePath) => ({ key: toBlobKey(storeRoot, filePath), etag: '' })),
                directories: [],
            };
        },
    };
};
