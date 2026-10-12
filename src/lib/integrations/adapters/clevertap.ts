import type { IntegrationAdapter } from "@/lib/integrations/types";
import { assertWriteAllowed, clevertapHost, writesEnabled } from "@/lib/integrations/clevertap/region";
import { normalizeCleverTapEvent } from "@/lib/integrations/clevertap/events";
import { safeEqual } from "@/lib/security/webhook-auth";

interface ClevertapCredentials {
  accountId: string;
  passcode: string;
  region?: string; // e.g. "in1", "eu1", "sg1" — blank means CleverTap's default region (Europe, not the US). Writes require "in1".
  webhookSecret?: string; // value of the X-Webhook-Secret custom header set on the CleverTap webhook
}

let creds: ClevertapCredentials | null = null;

function baseUrl(): string {
  if (!creds) throw new Error("Clevertap adapter not configured");
  return `https://${clevertapHost(creds.region ?? "")}/1`;
}

function headers(): HeadersInit {
  if (!creds) throw new Error("Clevertap adapter not configured");
  return {
    "X-CleverTap-Account-Id": creds.accountId,
    "X-CleverTap-Passcode": creds.passcode,
    "Content-Type": "application/json",
  };
}

export const clevertapAdapter: IntegrationAdapter = {
  provider: "clevertap",

  async configure(credentials) {
    creds = {
      accountId: String(credentials.accountId ?? ""),
      passcode: String(credentials.passcode ?? ""),
      region: credentials.region ? String(credentials.region) : undefined,
      webhookSecret: credentials.webhookSecret ? String(credentials.webhookSecret) : undefined,
    };
  },

  // Deliberately exempt from the India write guard: it uploads an empty `d: []` (no customer data) and is the only way to verify credentials before the region is switched.
  async testConnection() {
    try {
      const res = await fetch(`${baseUrl()}/upload`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ d: [] }),
      });
      if (!res.ok) return { ok: false, message: `Clevertap responded ${res.status}` };
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Connection failed" };
    }
  },

  // CleverTap webhooks don't sign payloads; they do send configured custom headers. Fails closed when unset.
  verifySignature(headers) {
    return safeEqual(headers["x-webhook-secret"], creds?.webhookSecret);
  },

  async handleWebhook(payload) {
    return normalizeCleverTapEvent(payload);
  },

  actions: {
    async syncProfile(client) {
      try {
        assertWriteAllowed(creds?.region);
        if (!writesEnabled()) throw new Error("CleverTap writes are switched off (CLEVERTAP_PUSH_ENABLED is not 1).");
        const identity = client.email ?? client.mobile ?? client.id;
        const res = await fetch(`${baseUrl()}/upload`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            d: [
              {
                identity,
                type: "profile",
                profileData: {
                  Name: client.name,
                  Email: client.email ?? undefined,
                  Phone: client.mobile ?? undefined,
                  clientStatus: client.status,
                },
              },
            ],
          }),
        });
        if (!res.ok) {
          return { success: false, error: `Clevertap responded ${res.status}: ${await res.text()}` };
        }
        const data = await res.json();
        return { success: true, data };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Request failed" };
      }
    },
  },
};
