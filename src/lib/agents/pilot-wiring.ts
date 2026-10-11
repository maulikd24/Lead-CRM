import { prisma } from "@/lib/db/prisma";
import { decryptJson, encryptJson } from "@/lib/security/crypto";
import type { LlmProvider } from "@/lib/ai/provider";
import { gatewayProvider } from "@/lib/ai/gateway";
import { isAgentEnabled } from "./wiring";
import { REPLY_KEY } from "./reply-assist";
import { pilotAccess, type PilotDb } from "./pilot-service";

/** Where the Admin-entered AI key lives: the existing encrypted credentials table, under its own provider name. */
export const AI_KEY_PROVIDER = "ai_provider";

export const pilotDb: PilotDb = {
  agentOn: () => isAgentEnabled(REPLY_KEY),
  listPilotUsers: async () => {
    const rows = await prisma.aiPilotUser.findMany({ orderBy: { addedAt: "asc" } });
    const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true, role: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({ userId: r.userId, name: byId.get(r.userId)?.name ?? "(removed user)", role: byId.get(r.userId)?.role ?? "?", addedById: r.addedById, addedAt: r.addedAt }));
  },
  findUser: (id) => prisma.user.findUnique({ where: { id }, select: { id: true, name: true, role: true, isActive: true } }),
  addPilotUser: async (userId, addedById, at) => {
    try { await prisma.aiPilotUser.create({ data: { userId, addedById, addedAt: at } }); return true; }
    catch (e) { if ((e as { code?: string }).code === "P2002") return false; throw e; }
  },
  removePilotUser: async (userId) => (await prisma.aiPilotUser.deleteMany({ where: { userId } })).count > 0,
  isListed: async (userId) => (await prisma.aiPilotUser.count({ where: { userId } })) > 0,
  activeSignoffs: () => prisma.aiPilotSignoff.findMany({ where: { revokedAt: null }, orderBy: { acknowledgedAt: "asc" }, select: { id: true, statementVersion: true, acknowledgedById: true, acknowledgedAt: true } }),
  createSignoff: async (s) => { await prisma.aiPilotSignoff.create({ data: s }); },
  revokeSignoffs: async (byId, at) => (await prisma.aiPilotSignoff.updateMany({ where: { revokedAt: null }, data: { revokedAt: at, revokedById: byId } })).count,
  aiKeyMeta: async () => {
    const row = await prisma.integrationConfig.findUnique({ where: { provider: AI_KEY_PROVIDER }, select: { credentials: true, settings: true, updatedAt: true } });
    if (!row?.credentials) return null;
    const s = (row.settings ?? {}) as { last4?: string; savedById?: string };
    return { last4: s.last4 ?? "", savedAt: row.updatedAt, savedById: s.savedById ?? "" };
  },
  saveAiKey: async (payload, last4, byId) => {
    await prisma.integrationConfig.upsert({
      where: { provider: AI_KEY_PROVIDER },
      create: { provider: AI_KEY_PROVIDER, mode: "live", isEnabled: true, credentials: payload, settings: { last4, savedById: byId } },
      update: { mode: "live", isEnabled: true, credentials: payload, settings: { last4, savedById: byId } },
    });
  },
  deleteAiKey: async () => (await prisma.integrationConfig.deleteMany({ where: { provider: AI_KEY_PROVIDER } })).count > 0,
  audit: async (e) => { await prisma.auditLog.create({ data: { userId: e.userId, entity: e.entity, entityId: e.entityId, action: e.action, oldValue: (e.oldValue ?? undefined) as never, newValue: (e.newValue ?? undefined) as never, reason: e.reason } }); },
};

export const pilotAccessFor = (userId: string) => pilotAccess(pilotDb, userId);
export const encryptForStorage = encryptJson;

/** The provider the pilot uses: built from the key an Admin saved in Settings, never from an environment key. Null when it cannot be read. */
export async function pilotProvider(env: NodeJS.ProcessEnv = process.env): Promise<LlmProvider | null> {
  try {
    const row = await prisma.integrationConfig.findUnique({ where: { provider: AI_KEY_PROVIDER }, select: { credentials: true } });
    if (!row?.credentials || typeof row.credentials !== "string") return null;
    const { apiKey } = decryptJson<{ apiKey?: string }>(row.credentials);
    // Only the Anthropic key can be saved in Settings; any other AI_PROVIDER means no pilot provider (as before).
    if ((env.AI_PROVIDER ?? "anthropic") !== "anthropic") return null;
    return apiKey ? gatewayProvider({ apiKey }) : null;
  } catch {
    return null; // never log: the error text could carry key material
  }
}
