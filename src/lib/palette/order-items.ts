/** Case-insensitive page match for the Cmd+K palette; an empty query matches every page. */
export function matchesPaletteQuery(label: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || label.toLowerCase().includes(q);
}

/**
 * Cmd+K item order. Client and page matches come first so Enter opens what the user typed;
 * "Ask" only becomes the default-selected item when nothing else matches.
 */
export function orderPaletteItems<T>(parts: { clients: T[]; nav: T[]; ask: T[]; actions: T[] }): T[] {
  return [...parts.clients, ...parts.nav, ...parts.ask, ...parts.actions];
}
