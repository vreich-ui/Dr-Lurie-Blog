import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

const localBlobsRoot = join(process.cwd(), '.netlify', 'local-blobs');

const toPath = (storeName: string, key: string) => join(localBlobsRoot, storeName, key);

const toBlobKey = (storeRoot: string, filePath: string) => relative(storeRoot, filePath).split(sep).join('/');

export type LocalBlobStore = {
  set: (key: string, value: string) => Promise<void>;
  get: (key: string) => Promise<string | null>;
  del: (key: string) => Promise<void>;
  setJSON: (key: string, value: unknown) => Promise<void>;
  list: (options?: {
    prefix?: string;
    directories?: boolean;
  }) => Promise<{ blobs: Array<{ key: string; etag: string }>; directories: string[] }>;
};

const listFiles = async (current: string): Promise<string[]> => {
  try {
    const entries = await readdir(current, { withFileTypes: true });
    const files = await Promise.all(
      entries.map((entry) => {
        const entryPath = join(current, entry.name);

        return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
      })
    );

    return files.flat();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
};

export const createLocalBlobStore = (storeName: string): LocalBlobStore => {
  const storeRoot = join(localBlobsRoot, storeName);

  return {
    async set(key, value) {
      const filePath = toPath(storeName, key);

      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, value, 'utf8');
    },

    async get(key) {
      try {
        return await readFile(toPath(storeName, key), 'utf8');
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          return null;
        }

        throw error;
      }
    },

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
