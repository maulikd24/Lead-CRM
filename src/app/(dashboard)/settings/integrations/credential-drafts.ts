/**
 * Credentials typed into an integration card but not saved yet. Switching tabs remounts the cards, so the typed text is kept here,
 * in memory only: never in the URL, never in storage, never logged. A full page reload, leaving Apps & Integrations (see
 * DraftsScope) or saving the card drops it.
 */
const drafts = new Map<string, Record<string, string>>();

export function readDraft(provider: string): Record<string, string> {
  return { ...(drafts.get(provider) ?? {}) };
}

export function writeDraft(provider: string, field: string, value: string): void {
  const next = { ...(drafts.get(provider) ?? {}) };
  if (value === "") delete next[field];
  else next[field] = value;
  if (Object.keys(next).length === 0) drafts.delete(provider);
  else drafts.set(provider, next);
}

export function clearDraft(provider: string): void {
  drafts.delete(provider);
}

export function clearAllDrafts(): void {
  drafts.clear();
}
