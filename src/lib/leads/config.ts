import { prisma } from "@/lib/db/prisma";
import { decryptJson } from "@/lib/security/crypto";
import { isProductionRuntime } from "@/lib/security/webhook-auth";

export const LEAD_INTAKE_PROVIDER = "lead_intake";

export type LeadIntakeConfig = {
  /** Switched to Live and not disabled. In a production runtime nothing is accepted unless this is true. */
  live: boolean;
  webSecret?: string;
  /** Public identifier embedded in a website form (not a secret) — only honoured together with allowedOrigins. */
  webFormKey?: string;
  allowedOrigins: string[];
  googleKey?: string;
  metaAppSecret?: string;
  metaVerifyToken?: string;
  metaPageToken?: string;
};

function clean(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

/** Credentials are encrypted at rest (same as every other integration); nothing is read from env vars. */
export async function getLeadIntakeConfig(): Promise<LeadIntakeConfig> {
  const row = await prisma.integrationConfig.findUnique({ where: { provider: LEAD_INTAKE_PROVIDER } });
  const credentials = row?.credentials ? decryptJson<Record<string, unknown>>(row.credentials as string) : {};
  return {
    live: row?.mode === "live" && row.isEnabled,
    webSecret: clean(credentials.webSecret),
    webFormKey: clean(credentials.webFormKey),
    allowedOrigins: (clean(credentials.allowedOrigins) ?? "")
      .split(",")
      .map((origin) => origin.trim().replace(/\/$/, ""))
      .filter(Boolean),
    googleKey: clean(credentials.googleKey),
    metaAppSecret: clean(credentials.metaAppSecret),
    metaVerifyToken: clean(credentials.metaVerifyToken),
    metaPageToken: clean(credentials.metaPageToken),
  };
}

/** Production only ever accepts leads once an Admin has switched Lead Sources to Live; elsewhere a configured secret is enough. */
export function intakeBlocked(config: LeadIntakeConfig): boolean {
  return isProductionRuntime() && !config.live;
}

/** Meta Lead Ads is on only when META_LEAD_ADS_ENABLED is "1" (the flag is on in the owner's profile). */
export function metaLeadAdsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.META_LEAD_ADS_ENABLED === "1";
}

/**
 * The Meta webhook's two secrets: META_APP_SECRET and META_WEBHOOK_VERIFY_TOKEN from the environment, or, when those are unset, the
 * same values saved in the lead-source credentials. The page token is always the saved one. Values are never logged or returned to a caller.
 */
export function metaWebhookSecrets(config: LeadIntakeConfig, env: NodeJS.ProcessEnv = process.env): { appSecret?: string; verifyToken?: string } {
  return { appSecret: clean(env.META_APP_SECRET) ?? config.metaAppSecret, verifyToken: clean(env.META_WEBHOOK_VERIFY_TOKEN) ?? config.metaVerifyToken };
}
