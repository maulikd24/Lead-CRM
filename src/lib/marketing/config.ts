import { prisma } from "@/lib/db/prisma";
import { decryptJson } from "@/lib/security/crypto";

export const META_ADS_PROVIDER = "meta_ads";

export { marketingPageEnabled, metaAdsSyncEnabled } from "./flags";

export type MetaAdsConfig = {
  /** Switched to Live, enabled, and holding an account id and a token. Nothing touches the network unless this is true. */
  live: boolean;
  accountId?: string;
  accessToken?: string;
  apiVersion?: string;
};

function clean(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

/** Credentials are encrypted at rest like every other integration; nothing is read from env vars. Never log the result. */
export async function getMetaAdsConfig(): Promise<MetaAdsConfig> {
  const row = await prisma.integrationConfig.findUnique({ where: { provider: META_ADS_PROVIDER } });
  const credentials = row?.credentials ? decryptJson<Record<string, unknown>>(row.credentials as string) : {};
  const accountId = clean(credentials.accountId)?.replace(/^act_/, "");
  const accessToken = clean(credentials.accessToken);
  return {
    live: row?.mode === "live" && row.isEnabled && Boolean(accountId) && Boolean(accessToken),
    accountId,
    accessToken,
    apiVersion: clean(credentials.apiVersion),
  };
}
