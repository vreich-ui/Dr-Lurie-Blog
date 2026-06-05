export type BlobListItem = { key: string };

export type BlobListResult = {
  blobs?: BlobListItem[];
  files?: BlobListItem[];
  directories?: string[];
};

export type BlobListResponse = BlobListResult | AsyncIterable<BlobListResult>;

const isObject = (value: unknown): value is Record<PropertyKey, unknown> => Boolean(value && typeof value === 'object');

export const isAsyncBlobListResponse = (value: BlobListResponse): value is AsyncIterable<BlobListResult> => {
  return isObject(value) && typeof value[Symbol.asyncIterator] === 'function';
};

export const getBlobListItems = (page: BlobListResult): BlobListItem[] => page.blobs ?? page.files ?? [];

export const collectBlobListItems = async (result: BlobListResponse): Promise<BlobListItem[]> => {
  const items: BlobListItem[] = [];

  if (isAsyncBlobListResponse(result)) {
    for await (const page of result) {
      items.push(...getBlobListItems(page));
    }
  } else {
    items.push(...getBlobListItems(result));
  }

  return items;
};
