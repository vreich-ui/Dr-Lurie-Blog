declare module '@netlify/blobs' {
  type BlobMetadata = Record<string, string>;

  type SetOptions = {
    metadata?: BlobMetadata;
    type?: string;
  };

  type NetlifyBlobStore = {
    set: (key: string, value: Buffer | ArrayBuffer | Blob | string, options?: SetOptions) => Promise<void>;
    setJSON: (key: string, value: unknown, options?: SetOptions) => Promise<void>;
  };

  export const connectLambda: (event: unknown) => void;
  export const getStore: (name: string) => NetlifyBlobStore;
}
