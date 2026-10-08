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
