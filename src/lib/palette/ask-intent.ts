const QUESTION_START = /^(which|what|who|where|why|how|show|list|find|kitne|kaun|kya)\b/i;

/** Decides whether a Cmd+K query should offer "Ask the system" on top of normal search. */
export function isAskIntent(query: string): boolean {
  const q = query.trim();
  if (q.length < 8) return false;
  return q.endsWith("?") || QUESTION_START.test(q);
}
