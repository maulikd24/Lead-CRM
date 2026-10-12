import { prisma } from "@/lib/db/prisma";
import { decryptJson } from "@/lib/security/crypto";
import { getAppProfile, type AppProfileResult } from "./get-app-profile";

/** Prisma wiring for the read-only card. Credentials are decrypted in memory only and never returned or logged. */
export function loadAppProfile(client: { email: string | null; mobile: string | null }): Promise<AppProfileResult> {
  return getAppProfile(client, {
    fetch: (input, init) => fetch(input, init),
    loadConfig: async () => {
      const config = await prisma.integrationConfig.findUnique({ where: { provider: "clevertap" } });
      if (!config) return null;
      return {
        mode: config.mode,
        isEnabled: config.isEnabled,
        credentials: config.credentials ? decryptJson<Record<string, unknown>>(config.credentials as string) : null,
      };
    },
  });
}
