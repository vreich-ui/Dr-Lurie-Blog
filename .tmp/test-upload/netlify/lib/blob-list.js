const isObject = (value) => Boolean(value && typeof value === 'object');
export const isAsyncBlobListResponse = (value) => {
    return (isObject(value) && typeof value[Symbol.asyncIterator] === 'function');
};
export const getBlobListItems = (page) => page.blobs ?? page.files ?? [];
export const collectBlobListItems = async (result) => {
    const items = [];
    if (isAsyncBlobListResponse(result)) {
        for await (const page of result) {
            items.push(...getBlobListItems(page));
        }
    }
    else {
        items.push(...getBlobListItems(result));
    }
    return items;
};
