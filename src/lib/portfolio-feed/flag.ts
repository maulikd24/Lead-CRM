/** The feed is off unless PORTFOLIO_FEED_ENABLED is "1"/"true" AND a signing secret exists. */
export function portfolioFeedSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const on = env.PORTFOLIO_FEED_ENABLED === "1" || env.PORTFOLIO_FEED_ENABLED === "true";
  const secret = env.PORTFOLIO_FEED_SECRET;
  return on && secret ? secret : null;
}

/** Customer 360 UI flag (client-visible build flag, same convention as NEXT_PUBLIC_CLEVERTAP_CARD). */
export function customer360Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NEXT_PUBLIC_C360 === "1";
}
