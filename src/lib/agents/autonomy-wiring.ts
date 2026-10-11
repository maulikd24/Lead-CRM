import { basePrisma } from "@/lib/db/prisma";

import type { AutonomyDeps } from "./autonomy-service";
import { agentEvalGate } from "./evals/agent-gate";

/** Production deps for setAutonomyLevel: the AgentAutonomy table, the audit log and the in-process eval gate. */
export const autonomyDeps: AutonomyDeps = {
  loadLevel: async (agentKey, actionType) => (await basePrisma.agentAutonomy.findUnique({ where: { agentKey_actionType: { agentKey, actionType } }, select: { level: true } }))?.level ?? null,
  saveLevel: async (agentKey, actionType, level, byId, reason) => {
    await basePrisma.agentAutonomy.upsert({
      where: { agentKey_actionType: { agentKey, actionType } },
      create: { agentKey, actionType, level, updatedById: byId, reason },
      update: { level, updatedById: byId, reason },
    });
  },
  evalGate: agentEvalGate,
  audit: async (e) => { await basePrisma.auditLog.create({ data: { userId: e.userId, entity: e.entity, entityId: e.entityId, action: e.action, oldValue: e.oldValue, newValue: e.newValue, reason: e.reason } }); },
};
