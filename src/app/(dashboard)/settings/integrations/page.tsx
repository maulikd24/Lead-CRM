import { basePrisma, prisma } from "@/lib/db/prisma";
import { loadIdentityCoverage } from "@/lib/integrations/clevertap/select-batch";
import { requireAccess } from "@/lib/auth/require-role";
import { INTEGRATION_PROVIDERS, EMAIL_PROVIDERS } from "@/lib/integrations/registry";
import { MESSAGING_CHANNELS, messagingProviderKeyFor } from "@/lib/messaging/registry";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkspaceHeading, WorkspacePanel, WorkspaceShell, WorkspaceTabs, parseTabParam, tabHref } from "@/components/workspace";
import { LEAD_INTAKE_PROVIDER } from "@/lib/leads/config";
import { GROUP_KEYS, INTEGRATION_GROUPS, STATE_LABEL, aiSafetyItems, groupOf, providerStatus, providersIn, webhooksFor, type StatusRow } from "@/lib/integrations/overview";
import { PROVIDER_META } from "./provider-meta";
import { AD_PLATFORM_PROVIDERS, adPlatformCards } from "./ad-platforms";
import { PageHeader } from "@/components/shared/page-header";
import { can } from "@/lib/access/policy";
import { IntegrationCard } from "./integration-card";
import { DraftsScope } from "./drafts-scope";
import { IntegrationsRail } from "./integrations-rail";
import { SafetyCard } from "./safety-card";

export const metadata = { title: "Apps & Integrations" };

export default async function IntegrationsSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireAccess("marketing-ad-integrations");
  // A marketing user gets read-only cards for the ad platforms and nothing else: no credentials, forms, other providers or webhook URLs.
  if (!can(session.user.role, "settings-integrations", "view")) {
    const configs = await prisma.integrationConfig.findMany({ where: { provider: { in: [...AD_PLATFORM_PROVIDERS] } }, select: { provider: true, mode: true, credentials: true } });
    const cards = adPlatformCards(configs, process.env);
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Ad platforms" description="Status of the connected ad accounts. Read-only: an Admin manages the connections." />
        <div className="grid gap-4 md:grid-cols-2">
          {cards.map((c) => (
            <Card key={c.provider}>
              <CardHeader>
                <CardTitle className="text-base">{c.label}</CardTitle>
                <CardDescription>{STATE_LABEL[c.state]}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    );
  }
  const tab = parseTabParam((await searchParams).tab, GROUP_KEYS, "messaging") as (typeof GROUP_KEYS)[number];

  const messagingProviders = MESSAGING_CHANNELS.map((c) => messagingProviderKeyFor(c));
  const allProviders = [...INTEGRATION_PROVIDERS, ...messagingProviders, ...EMAIL_PROVIDERS, LEAD_INTAKE_PROVIDER];

  const configs = await prisma.integrationConfig.findMany({ where: { provider: { in: allProviders } } });
  const configByProvider = new Map(configs.map((c) => [c.provider, c]));

  // Read-only counts for the CleverTap card. A failed count must never break the settings page.
  const clevertapCoverage = tab === "data" ? await loadIdentityCoverage(basePrisma).catch(() => null) : null;

  const env = process.env;
  const status = (provider: string) => providerStatus(provider, configByProvider.get(provider) ?? null, env);
  const safety = aiSafetyItems(env);
  const rows: StatusRow[] = [
    ...allProviders.map((p) => {
      const s = status(p);
      return { id: p, label: PROVIDER_META[p]?.label ?? p, group: groupOf(p), state: s.state, detail: s.flagName };
    }),
    ...safety.map((i) => ({ id: i.id, label: i.label, group: "ai" as const, state: i.state })),
  ].sort((a, b) => GROUP_KEYS.indexOf(a.group) - GROUP_KEYS.indexOf(b.group));

  const group = INTEGRATION_GROUPS.find((g) => g.key === tab)!;
  const tabs = INTEGRATION_GROUPS.map((g) => ({ key: g.key, label: g.label, href: tabHref("/settings/integrations", "", g.key, { fallback: "messaging" }) }));
  const hooks = webhooksFor(tab, { providers: INTEGRATION_PROVIDERS, channels: MESSAGING_CHANNELS });

  return (
    <>
    <DraftsScope />
    <WorkspaceShell
      hasRail
      header={<WorkspaceHeading title="Apps & Integrations" description="Each integration runs in Mock mode until you add real credentials — journeys and manual actions work fully against mock data in the meantime." />}
      tabs={<WorkspaceTabs tabs={tabs} active={tab} idPrefix="integ" label="Integration groups" />}
      rail={<IntegrationsRail rows={rows} />}
    >
      <WorkspacePanel tab={tab} idPrefix="integ">
        <p className="text-sm text-muted-foreground">{group.blurb}</p>
        <div className="grid items-start gap-4 md:grid-cols-2">
          {tab === "ai"
            ? safety.map((item, i) => <SafetyCard key={item.id} item={item} index={i} />)
            : providersIn(tab, allProviders).map((provider, i) => (
                <IntegrationCard
                  key={provider}
                  provider={provider}
                  meta={PROVIDER_META[provider]}
                  config={configByProvider.get(provider) ?? null}
                  identityCoverage={provider === "clevertap" ? clevertapCoverage : null}
                  status={status(provider)}
                  index={i}
                />
              ))}
        </div>
        {hooks.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Webhook URLs</CardTitle>
              <CardDescription>
                Point each provider&apos;s outbound webhooks/automations at these URLs to feed events back into Allvest.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 break-all font-mono text-sm text-muted-foreground">
              {hooks.map((h) => (
                <span key={h.path}>{h.path}{h.note ? ` (${h.note})` : ""}</span>
              ))}
            </CardContent>
          </Card>
        )}
      </WorkspacePanel>
    </WorkspaceShell>
    </>
  );
}
