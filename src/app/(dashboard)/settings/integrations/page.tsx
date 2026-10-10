import { basePrisma, prisma } from "@/lib/db/prisma";
import { loadIdentityCoverage } from "@/lib/integrations/clevertap/select-batch";
import { requireRole } from "@/lib/auth/require-role";
import { INTEGRATION_PROVIDERS, EMAIL_PROVIDERS } from "@/lib/integrations/registry";
import { MESSAGING_CHANNELS, messagingProviderKeyFor } from "@/lib/messaging/registry";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { LEAD_INTAKE_PROVIDER } from "@/lib/leads/config";
import { PROVIDER_META } from "./provider-meta";
import { IntegrationCard } from "./integration-card";

export default async function IntegrationsSettingsPage() {
  await requireRole(["ADMIN"]);

  const messagingProviders = MESSAGING_CHANNELS.map((c) => messagingProviderKeyFor(c));
  const allProviders = [...INTEGRATION_PROVIDERS, ...messagingProviders, ...EMAIL_PROVIDERS, LEAD_INTAKE_PROVIDER];

  const configs = await prisma.integrationConfig.findMany({ where: { provider: { in: allProviders } } });
  const configByProvider = new Map(configs.map((c) => [c.provider, c]));

  // Read-only counts for the CleverTap card. A failed count must never break the settings page.
  const clevertapCoverage = await loadIdentityCoverage(basePrisma).catch(() => null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Apps & Integrations"
        description="Each integration runs in Mock mode until you add real credentials — journeys and manual actions work fully against mock data in the meantime."
      />

      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">Business Tools</h2>
        <div className="columns-1 gap-4 md:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
          {INTEGRATION_PROVIDERS.map((provider) => (
            <IntegrationCard
              key={provider}
              provider={provider}
              meta={PROVIDER_META[provider]}
              config={configByProvider.get(provider) ?? null}
              identityCoverage={provider === "clevertap" ? clevertapCoverage : null}
            />
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">Lead Sources</h2>
        <div className="columns-1 gap-4 md:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
          <IntegrationCard
            provider={LEAD_INTAKE_PROVIDER}
            meta={PROVIDER_META[LEAD_INTAKE_PROVIDER]}
            config={configByProvider.get(LEAD_INTAKE_PROVIDER) ?? null}
          />
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">Messaging Channels</h2>
        <div className="columns-1 gap-4 md:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
          {messagingProviders.map((provider) => (
            <IntegrationCard
              key={provider}
              provider={provider}
              meta={PROVIDER_META[provider]}
              config={configByProvider.get(provider) ?? null}
            />
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">Notifications</h2>
        <div className="columns-1 gap-4 md:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
          {EMAIL_PROVIDERS.map((provider) => (
            <IntegrationCard
              key={provider}
              provider={provider}
              meta={PROVIDER_META[provider]}
              config={configByProvider.get(provider) ?? null}
            />
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Webhook URLs</CardTitle>
          <CardDescription>
            Point each provider&apos;s outbound webhooks/automations at these URLs to feed events back into
            Supportify.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm font-mono text-muted-foreground">
          {INTEGRATION_PROVIDERS.map((provider) => (
            <span key={provider}>/api/webhooks/{provider}</span>
          ))}
          {MESSAGING_CHANNELS.map((channel) => (
            <span key={channel}>/api/webhooks/messaging/{channel}</span>
          ))}
          <span>/api/webhooks/meta-leads (Meta Lead Ads — Facebook &amp; Instagram)</span>
          <span>/api/leads/google-ads (Google Ads lead forms)</span>
          <span>/api/leads/web (website, blog &amp; contact forms)</span>
        </CardContent>
      </Card>
    </div>
  );
}
