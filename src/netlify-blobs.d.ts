declare module '@netlify/blobs' {
  type BlobMetadata = Record<string, string>;

  type BlobGetType = 'text' | 'json' | 'arrayBuffer' | 'blob' | 'stream';

  type BlobListResultBlob = { key: string; etag?: string };
  type BlobListResult = { blobs?: BlobListResultBlob[]; directories?: string[] };

  export interface Store {
    get: (key: string, options?: { type?: BlobGetType }) => Promise<unknown>;
    getWithMetadata: (
      key: string,
      options?: { type?: BlobGetType }
    ) => Promise<{ data: unknown; metadata?: BlobMetadata } | null>;
    getMetadata: (key: string) => Promise<{ metadata: BlobMetadata } | null>;
    set: (key: string, value: unknown, options?: { metadata?: BlobMetadata }) => Promise<unknown>;
    setJSON: (key: string, value: unknown, options?: { metadata?: BlobMetadata }) => Promise<unknown>;
    delete: (key: string) => Promise<void>;
    del: (key: string) => Promise<void>;
    list: (options?: {
      prefix?: string;
      directories?: boolean;
      paginate?: boolean;
      limit?: number;
      cursor?: string;
    }) => Promise<BlobListResult> & AsyncIterable<BlobListResult>;
  }

  type StoreOptions = {
    name: string;
    siteID?: string;
    token?: string;
    apiURL?: string;
    consistency?: 'strong' | 'eventual';
  };

  type ClientOptions = {
    siteID?: string;
    token?: string;
    apiURL?: string;
  };

  export const connectLambda: (event: unknown) => void;
  export function getStore(name: string): Store;
  export function getStore(options: StoreOptions): Store;
  export function listStores(options?: ClientOptions): Promise<{ stores: string[]; next_cursor?: string }>;
}
