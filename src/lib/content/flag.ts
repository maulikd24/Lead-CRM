/** The server flag for the content engine. Default off; on only for the exact value "1". Registered in src/lib/flags/registry.ts. */
export const CONTENT_ENGINE_FLAG = "CONTENT_ENGINE_ENABLED";

export function contentEngineEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[CONTENT_ENGINE_FLAG] === "1";
}
