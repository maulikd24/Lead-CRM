/** Experiment layer switch (server). Off unless exactly "1". Nothing in this folder reads it yet; it gates the callers that come later. */
export function experimentsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.EXPERIMENTS_ENABLED === "1";
}
