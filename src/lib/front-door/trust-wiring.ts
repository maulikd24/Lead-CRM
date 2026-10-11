import { prisma } from "@/lib/db/prisma";

import type { TrustRecord, TrustSignoffDb } from "./trust-signoff";
import { isTrustSignedOff } from "./trust-signoff";

const PROVIDER = "landing_trust_signoff";

export const trustSignoffDb: TrustSignoffDb = {
  read: async () => {
    const row = await prisma.integrationConfig.findUnique({ where: { provider: PROVIDER }, select: { settings: true } });
    const s = row?.settings;
    return s && typeof s === "object" && !Array.isArray(s) ? (s as unknown as TrustRecord) : null;
  },
  save: async (r) => {
    await prisma.integrationConfig.upsert({ where: { provider: PROVIDER }, create: { provider: PROVIDER, mode: "live", settings: r as never, isEnabled: true }, update: { settings: r as never, isEnabled: true } });
  },
  clear: async () => {
    await prisma.integrationConfig.deleteMany({ where: { provider: PROVIDER } });
  },
  audit: async (e) => {
    await prisma.auditLog.create({ data: { userId: e.userId, entity: e.entity, entityId: e.entityId, action: e.action, oldValue: e.oldValue as never, newValue: e.newValue as never } });
  },
};

/** For the landing page: any database error means "not signed off", so the strip stays hidden. */
export async function trustStripSignedOff(): Promise<boolean> {
  try {
    return isTrustSignedOff(await trustSignoffDb.read());
  } catch {
    return false;
  }
}
