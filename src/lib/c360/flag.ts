/** Customer 360 UI flag (client-visible build flag, same convention as NEXT_PUBLIC_CLEVERTAP_CARD). Off by default. */
export function customer360Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NEXT_PUBLIC_C360 === "1";
}
