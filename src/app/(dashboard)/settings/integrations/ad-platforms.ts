import { providerStatus, type IntegrationState } from "@/lib/integrations/overview";

import { PROVIDER_META } from "./provider-meta";

/** The only integrations a marketing user sees: the ad platforms, as read-only status cards. No credential, form or webhook URL is part of it. */
export const AD_PLATFORM_PROVIDERS = ["meta_ads", "google_ads"] as const;

export type AdPlatformCard = { provider: string; label: string; state: IntegrationState };

export function adPlatformCards(configs: { provider: string; mode: string; credentials: unknown }[], env: Record<string, string | undefined>): AdPlatformCard[] {
  return AD_PLATFORM_PROVIDERS.map((provider) => {
    const config = configs.find((c) => c.provider === provider) ?? null;
    return { provider, label: PROVIDER_META[provider]?.label ?? provider, state: providerStatus(provider, config, env).state };
  });
}
