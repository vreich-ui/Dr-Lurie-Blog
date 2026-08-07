import type { ChatDoc } from './chat-store.js';

export const visibleChatDocs = (
  docs: ChatDoc[],
  callerEmail: string,
  includeAll: boolean,
  owner: boolean
): ChatDoc[] => {
  if (includeAll && owner) return docs;
  const email = callerEmail.trim().toLowerCase();
  return docs.filter((doc) => doc.created_by.trim().toLowerCase() === email);
};
