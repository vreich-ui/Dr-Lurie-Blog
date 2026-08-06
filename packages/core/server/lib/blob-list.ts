export type BlobListItem = { key: string };

export type BlobListResult = {
  blobs?: BlobListItem[];
  files?: BlobListItem[];
  directories?: string[];
};

export type BlobListResponse = BlobListResult | AsyncIterable<BlobListResult>;

const isObject = (value: unknown): value is Record<PropertyKey, unknown> => Boolean(value && typeof value === 'object');

export const isAsyncBlobListResponse = (value: BlobListResponse): value is AsyncIterable<BlobListResult> => {
  return (
    isObject(value) && typeof (value as Partial<AsyncIterable<BlobListResult>>)[Symbol.asyncIterator] === 'function'
  );
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

/**
 * Bounds how many blob `get`s (or `list`s) run concurrently against the
 * store. High enough to collapse a serial ~70-record sweep into a handful of
 * parallel batches, low enough not to hammer the underlying blob API.
 */
export const STORE_READ_CONCURRENCY = 16;

/**
 * Map `items` through `fn` with at most `limit` in flight at once, preserving
 * INPUT ORDER in the returned array regardless of which items resolve first —
 * callers that depend on positional output (e.g. zipping results back against
 * their source items) can rely on `result[i]` corresponding to `items[i]`.
 */
export const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
};
