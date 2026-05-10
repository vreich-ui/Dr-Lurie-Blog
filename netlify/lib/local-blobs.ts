import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const localBlobsRoot = join(process.cwd(), '.netlify', 'local-blobs');

const toPath = (storeName: string, key: string) => join(localBlobsRoot, storeName, key);

export type LocalBlobStore = {
  set: (key: string, value: string) => Promise<void>;
  get: (key: string) => Promise<string | null>;
  del: (key: string) => Promise<void>;
  setJSON: (key: string, value: unknown) => Promise<void>;
};

export const createLocalBlobStore = (storeName: string): LocalBlobStore => {
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
  };
};
