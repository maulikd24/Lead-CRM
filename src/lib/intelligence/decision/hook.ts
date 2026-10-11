// The only line the existing refresh job calls. Off unless NBA_ENGINE_V2=1 AND the AgentSetting row "nba_engine" is enabled (kill switch).
// A failure here is logged and swallowed: the shadow engine must never break the refresh it rides on.
import type { IntelligenceResult } from "../refresh";
import { ENGINE_FLAG, engineEnabled } from "./enabled";

export async function shadowAfterRefresh(clientId: string, result: IntelligenceResult): Promise<void> {
  if (process.env[ENGINE_FLAG] !== "1") return;
  try {
    const { basePrisma } = await import("@/lib/db/prisma");
    if (!(await engineEnabled(process.env, (agentKey) => basePrisma.agentSetting.findUnique({ where: { agentKey }, select: { enabled: true } })))) return;
    const { runShadowDecision } = await import("./shadow");
    await runShadowDecision(clientId, { result });
    const { linkOutcomesForClient } = await import("./outcomes-db");
    await linkOutcomesForClient(clientId);
  } catch (error) {
    console.error("Decision engine (shadow) failed for", clientId, error instanceof Error ? error.message : error);
  }
}
