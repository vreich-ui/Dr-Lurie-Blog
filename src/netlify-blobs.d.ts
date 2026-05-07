declare module '@netlify/blobs' {
  type BlobMetadata = Record<string, string>;

  type NetlifyBlobStore = {
    setJSON: (key: string, value: unknown, options?: { metadata?: BlobMetadata }) => Promise<void>;
  };

  export const connectLambda: (event: unknown) => void;
  export const getStore: (name: string) => NetlifyBlobStore;
}
