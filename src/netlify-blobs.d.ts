declare module '@netlify/blobs' {
  type BlobMetadata = Record<string, string>;

  type NetlifyBlobStore = {
    set: (key: string, value: string, options?: { metadata?: BlobMetadata }) => Promise<void>;
    get: (key: string) => Promise<string | null>;
    del: (key: string) => Promise<void>;
    setJSON: (key: string, value: unknown, options?: { metadata?: BlobMetadata }) => Promise<void>;
    list: (options?: {
      prefix?: string;
      directories?: boolean;
    }) => Promise<{ blobs: Array<{ key: string; etag: string }>; directories: string[] }>;
  };

  export const connectLambda: (event: unknown) => void;
  export const getStore: (name: string) => NetlifyBlobStore;
}
