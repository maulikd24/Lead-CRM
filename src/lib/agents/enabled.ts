/** Each agent has its own env switch; AGENT_NUDGER_ENABLED belongs to the nudger only. */
export const ENV_FLAG_BY_AGENT: Record<string, string> = { wa_nudger: "AGENT_NUDGER_ENABLED" };

/** Kill switch: the agent runs only if the agent's env flag is "1" AND its AgentSetting row is enabled. Prisma-free so it is unit-testable. */
export async function agentEnabled(
  agentKey: string,
  env: Record<string, string | undefined>,
  lookup: (agentKey: string) => Promise<{ enabled: boolean } | null>,
): Promise<boolean> {
  const flag = ENV_FLAG_BY_AGENT[agentKey];
  if (!flag || env[flag] !== "1") return false;
  return (await lookup(agentKey))?.enabled === true;
}
