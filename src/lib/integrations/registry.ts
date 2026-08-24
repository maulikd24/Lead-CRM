import { prisma } from "@/lib/db/prisma";
import { decryptJson } from "@/lib/security/crypto";
import type { IntegrationAdapter } from "@/lib/integrations/types";

import { freshdeskAdapter } from "@/lib/integrations/adapters/freshdesk";
import { exotelAdapter } from "@/lib/integrations/adapters/exotel";
import { clevertapAdapter } from "@/lib/integrations/adapters/clevertap";
import { freshdeskMockAdapter } from "@/lib/integrations/adapters/mock/freshdesk.mock";
import { exotelMockAdapter } from "@/lib/integrations/adapters/mock/exotel.mock";
import { clevertapMockAdapter } from "@/lib/integrations/adapters/mock/clevertap.mock";

const LIVE_ADAPTERS: Record<string, IntegrationAdapter> = {
  freshdesk: freshdeskAdapter,
  exotel: exotelAdapter,
  clevertap: clevertapAdapter,
};

const MOCK_ADAPTERS: Record<string, IntegrationAdapter> = {
  freshdesk: freshdeskMockAdapter,
  exotel: exotelMockAdapter,
  clevertap: clevertapMockAdapter,
};

export const INTEGRATION_PROVIDERS = Object.keys(LIVE_ADAPTERS);

/** Resolves the configured adapter (mock or live) for a provider, applying stored credentials/settings. */
export async function getAdapter(provider: string): Promise<IntegrationAdapter> {
  const config = await prisma.integrationConfig.findUnique({ where: { provider } });
  const mode = config?.mode ?? "mock";

  if (mode !== "live") {
    return MOCK_ADAPTERS[provider] ?? notFound(provider);
  }

  const adapter = LIVE_ADAPTERS[provider] ?? notFound(provider);
  const credentials = config?.credentials ? decryptJson<Record<string, unknown>>(config.credentials as string) : {};
  const settings = (config?.settings as Record<string, unknown>) ?? {};
  await adapter.configure(credentials, settings);
  return adapter;
}

function notFound(provider: string): never {
  throw new Error(`Unknown integration provider: ${provider}`);
}
