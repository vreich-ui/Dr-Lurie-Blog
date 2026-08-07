/** Allow only ordinary web links in untrusted assistant markdown. */
export const safeMarkdownUrl = (url: string): string => {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : '';
};
