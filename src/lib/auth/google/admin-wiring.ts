import { prisma } from "@/lib/db/prisma";

import type { GoogleSettingsDb } from "./admin";
import { GOOGLE_SETTINGS_PROVIDER, loadGoogleAllowedDomains } from "./settings";

/** The real database behind the sign-in settings. Uses the existing IntegrationConfig table (no migration). */
export const googleSettingsDb: GoogleSettingsDb = {
  read: loadGoogleAllowedDomains,
  write: async (domains) => {
    await prisma.integrationConfig.upsert({
      where: { provider: GOOGLE_SETTINGS_PROVIDER },
      create: { provider: GOOGLE_SETTINGS_PROVIDER, mode: "live", settings: { allowedDomains: domains }, isEnabled: domains.length > 0 },
      update: { settings: { allowedDomains: domains }, isEnabled: domains.length > 0 },
    });
  },
  audit: async (e) => {
    await prisma.auditLog.create({ data: { userId: e.userId, entity: e.entity, entityId: e.entityId, action: e.action, oldValue: e.oldValue as never, newValue: e.newValue as never } });
  },
};
