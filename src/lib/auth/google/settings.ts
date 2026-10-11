import { prisma } from "@/lib/db/prisma";

import { parseAllowedDomains } from "./index";

/** Where the admin's allow-list lives: the existing IntegrationConfig table (settings JSON), so no migration is needed. */
export const GOOGLE_SETTINGS_PROVIDER = "google_signin";

/** The configured company domains; empty (the default) means Google sign-in is disabled. */
export async function loadGoogleAllowedDomains(): Promise<string[]> {
  const row = await prisma.integrationConfig.findUnique({ where: { provider: GOOGLE_SETTINGS_PROVIDER }, select: { settings: true } });
  const settings = row?.settings;
  return parseAllowedDomains(settings && typeof settings === "object" && !Array.isArray(settings) ? (settings as Record<string, unknown>).allowedDomains : undefined);
}
