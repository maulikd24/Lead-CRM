/** The feed is off unless PORTFOLIO_FEED_ENABLED is "1"/"true" AND a signing secret exists. */
export function portfolioFeedSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const on = env.PORTFOLIO_FEED_ENABLED === "1" || env.PORTFOLIO_FEED_ENABLED === "true";
  const secret = env.PORTFOLIO_FEED_SECRET;
  return on && secret ? secret : null;
}
