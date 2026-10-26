/** Template placeholders are `{{key}}`. Pure, so the Campaign Studio preview can render them in the browser too. */
const PLACEHOLDER = /\{\{(\w+)\}\}/g;

export function substitute(body: string, variables: Record<string, string>): string {
  return body.replace(PLACEHOLDER, (_, key) => variables[key] ?? `{{${key}}}`);
}

/** The distinct placeholder keys of a template body, in first-use order. */
export function variablesOf(body: string): string[] {
  return [...new Set([...body.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}
