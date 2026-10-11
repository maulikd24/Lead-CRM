import { ACTION_TYPES, LEVEL_LABEL, assertWithinCeiling, AutonomyCeilingError, effectiveLevel, isActionType, type AutonomyLevel } from "./autonomy";
import { getAgent } from "./registry";

/**
 * Changing an autonomy level. An Admin action, audited, capped by the ceilings in code, and a RAISE needs the agent's eval gate
 * to be green and a written reason. Lowering is always allowed (it is the safe direction) and is audited too.
 */
export class AutonomyForbiddenError extends Error {
  constructor() { super("Only an Admin can change an agent's autonomy level."); this.name = "AutonomyForbiddenError"; }
}
export class EvalGateError extends Error {
  constructor(readonly agentKey: string, readonly detail: string) { super(`Cannot raise ${agentKey}: its eval gate is not green (${detail}).`); this.name = "EvalGateError"; }
}

export type AuditEntry = { userId: string; entity: "AgentAutonomy"; entityId: string; action: "agent.autonomy.raise" | "agent.autonomy.lower"; oldValue: { level: number }; newValue: { level: number }; reason: string };

export type AutonomyDeps = {
  loadLevel: (agentKey: string, actionType: string) => Promise<number | null>;
  saveLevel: (agentKey: string, actionType: string, level: number, byId: string, reason: string) => Promise<void>;
  /** Is the agent's eval suite green right now? */
  evalGate: (agentKey: string) => Promise<{ green: boolean; detail: string }>;
  audit: (entry: AuditEntry) => Promise<void>;
};

export async function setAutonomyLevel(
  deps: AutonomyDeps,
  actor: { id: string; role: string },
  input: { agentKey: string; actionType: string; level: number; reason?: string },
): Promise<{ from: number; to: number; changed: boolean }> {
  if (actor.role !== "ADMIN") throw new AutonomyForbiddenError();
  const agent = getAgent(input.agentKey);
  if (!agent) throw new Error(`Unknown agent "${input.agentKey}"`);
  if (!isActionType(input.actionType)) throw new Error(`Unknown action type "${input.actionType}"`);
  const entry = agent.actions.find((a) => a.actionType === input.actionType);
  if (!entry) throw new Error(`"${input.actionType}" is not an action of ${agent.key}`);

  assertWithinCeiling(input.actionType, input.level); // the ceilings in code
  if (input.level > entry.maxLevel) throw new AutonomyCeilingError(input.actionType, input.level, entry.maxLevel); // the agent's own maximum

  const from = effectiveLevel(entry, input.actionType, await deps.loadLevel(agent.key, input.actionType));
  const to = input.level as AutonomyLevel;
  if (to === from) return { from, to, changed: false };

  const reason = (input.reason ?? "").trim();
  const raising = to > from;
  if (raising) {
    if (!reason) throw new Error("A reason is required to raise an agent's autonomy level.");
    const gate = agent.evalSuite ? await deps.evalGate(agent.key) : { green: false, detail: "the agent has no eval suite yet" };
    if (!gate.green) throw new EvalGateError(agent.key, gate.detail);
  }
  // Audit first: a change that cannot be audited does not happen.
  await deps.audit({ userId: actor.id, entity: "AgentAutonomy", entityId: `${agent.key}:${input.actionType}`, action: raising ? "agent.autonomy.raise" : "agent.autonomy.lower", oldValue: { level: from }, newValue: { level: to }, reason: reason || `lowered to ${LEVEL_LABEL[to]}` });
  await deps.saveLevel(agent.key, input.actionType, to, actor.id, reason || `lowered to ${LEVEL_LABEL[to]}`);
  return { from, to, changed: true };
}

export const ACTION_LABEL = (id: string) => (isActionType(id) ? ACTION_TYPES[id].label : id);
