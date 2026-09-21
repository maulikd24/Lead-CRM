import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { INTEGRATION_PROVIDERS, EMAIL_PROVIDERS } from "@/lib/integrations/registry";
import { MESSAGING_CHANNELS, messagingProviderKeyFor } from "@/lib/messaging/registry";
import { PROVIDER_META } from "@/app/(dashboard)/settings/integrations/provider-meta";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils/format";
import Link from "next/link";

// Only these 4 of the 12 cron jobs persist a queryable run history via DailyJobRun (confirmed via
// grep — the rest use other idempotency mechanisms with no "last ran at" to show). Keep this list in
// sync with src/app/api/internal/cron/tick/route.ts if jobs are added/removed/renamed.
const DAILY_JOB_RUN_JOBS = [
  "daily_leads_report",
  "weekly_management_report",
  "monthly_management_report",
  "seed_distribution_os_demo",
] as const;

const CRON_JOBS: { name: string; description: string; cadence: string; dailyJobRunName?: (typeof DAILY_JOB_RUN_JOBS)[number] }[] = [
  { name: "checkOverdueTasks", description: "Flips Task.status to OVERDUE past its due date", cadence: "Every tick (~5 min)" },
  { name: "checkStageSla", description: "Notifies the RM/manager of stage SLA breaches", cadence: "Every tick (~5 min)" },
  { name: "checkFundingSla", description: "Follow-up task + escalation for funding stuck pending", cadence: "Every tick (~5 min)" },
  { name: "processDueJourneySteps", description: "Advances due Journey automation steps", cadence: "Every tick (~5 min)" },
  { name: "checkDisengagement", description: "Flags clients with no recent activity", cadence: "Every tick (~5 min)" },
  { name: "sendDailyReportEmail", description: "Org-wide leads-activity digest email", cadence: "Once daily, ~9 PM IST", dailyJobRunName: "daily_leads_report" },
  { name: "sendWeeklyManagementReport", description: "Weekly management summary email", cadence: "Mondays, ~9 PM IST", dailyJobRunName: "weekly_management_report" },
  { name: "sendMonthlyManagementReport", description: "Monthly management summary email", cadence: "1st of the month, ~9 PM IST", dailyJobRunName: "monthly_management_report" },
  { name: "seedDistributionOsDemoData", description: "One-time production demo-data seed", cadence: "One-time", dailyJobRunName: "seed_distribution_os_demo" },
  { name: "seedBaselineStages", description: "Idempotent upsert of the 6 onboarding stages", cadence: "Every tick, self-healing completion-check" },
  { name: "seedSystemActor", description: "Idempotent seed of the webhook system actor account", cadence: "Every tick, self-healing completion-check" },
  { name: "backfillCompletedClientsToFinalStage", description: "Moves legacy-completed clients onto the real final stage", cadence: "Every tick, no-op once caught up" },
];

// Presence-only checks — never render an actual value on this page, only whether it's set.
const ENV_VARS = ["DATABASE_URL", "ENCRYPTION_KEY", "CRON_SECRET", "NEXTAUTH_URL", "META_WEBHOOK_VERIFY_TOKEN", "DAILY_REPORT_RECIPIENT_EMAIL"];

const OTHER_API_ROUTES = [
  "/api/internal/cron/tick",
  "/api/auth/[...nextauth]",
  "/api/clients/export",
  "/api/reports/summary-pdf",
  "/api/reports/management-dashboard-pdf",
  "/api/reports/rm-daily-report",
  "/api/reports/leads-summary",
];

export default async function SystemOverviewPage() {
  await requireRole(["ADMIN"]);

  const messagingProviders = MESSAGING_CHANNELS.map((c) => messagingProviderKeyFor(c));
  const allProviders = [...INTEGRATION_PROVIDERS, ...messagingProviders, ...EMAIL_PROVIDERS];

  const [configs, dailyJobRuns] = await Promise.all([
    prisma.integrationConfig.findMany({ where: { provider: { in: allProviders } } }),
    Promise.all(
      DAILY_JOB_RUN_JOBS.map((jobName) => prisma.dailyJobRun.findFirst({ where: { jobName }, orderBy: { createdAt: "desc" } })),
    ),
  ]);
  const configByProvider = new Map(configs.map((c) => [c.provider, c]));
  const lastRunByJobName = new Map(DAILY_JOB_RUN_JOBS.map((name, i) => [name, dailyJobRuns[i]]));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="System Overview"
        description="A live, read-only status view of every tool, API, and scheduled job this app depends on."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Integrations Status</CardTitle>
          <CardDescription>
            Live from the database.{" "}
            <Link href="/settings/integrations" className="underline">
              Manage credentials in Apps &amp; Integrations →
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead>Last Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody striped>
              {allProviders.map((provider) => {
                const config = configByProvider.get(provider) ?? null;
                const mode = config?.mode ?? "mock";
                return (
                  <TableRow key={provider}>
                    <TableCell className="text-sm font-medium">{PROVIDER_META[provider]?.label ?? provider}</TableCell>
                    <TableCell>
                      <Badge variant={mode === "live" ? "success" : "outline"}>{mode === "live" ? "Live" : "Mock"}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={config?.isEnabled ? "success" : "outline"}>{config?.isEnabled ? "Enabled" : "Disabled"}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {config ? formatDateTime(config.updatedAt) : "Never configured"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scheduled Jobs</CardTitle>
          <CardDescription>
            Triggered by a GitHub Actions workflow (<code>.github/workflows/journey-cron.yml</code>) on a{" "}
            <code>*/5 * * * *</code> schedule (plus manual dispatch), which POSTs to{" "}
            <code>/api/internal/cron/tick</code> with an <code>x-cron-secret</code> header. GitHub&apos;s
            actual firing cadence for a 5-minute schedule can run well behind that in practice — this is
            the configured interval, not a guarantee.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Cadence</TableHead>
                <TableHead>Last Run</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody striped>
              {CRON_JOBS.map((job) => {
                const lastRun = job.dailyJobRunName ? lastRunByJobName.get(job.dailyJobRunName) : undefined;
                return (
                  <TableRow key={job.name}>
                    <TableCell className="text-sm">
                      <p className="font-medium">{job.name}</p>
                      <p className="text-xs text-muted-foreground">{job.description}</p>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{job.cadence}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {job.dailyJobRunName ? (lastRun ? formatDateTime(lastRun.createdAt) : "Never run yet") : "— (no persisted history)"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">API Routes</CardTitle>
          <CardDescription>Every externally-callable route this app exposes.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <p className="mb-1 text-sm font-medium">Inbound Webhooks</p>
            <div className="flex flex-col gap-1 font-mono text-sm text-muted-foreground">
              {INTEGRATION_PROVIDERS.map((provider) => (
                <span key={provider}>/api/webhooks/{provider}</span>
              ))}
              {MESSAGING_CHANNELS.map((channel) => (
                <span key={channel}>/api/webhooks/messaging/{channel}</span>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">Other API Routes</p>
            <div className="flex flex-col gap-1 font-mono text-sm text-muted-foreground">
              {OTHER_API_ROUTES.map((route) => (
                <span key={route}>{route}</span>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Environment &amp; Infrastructure</CardTitle>
          <CardDescription>Presence only — values are never shown here.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Variable</TableHead>
                <TableHead>Configured</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody striped>
              {ENV_VARS.map((name) => (
                <TableRow key={name}>
                  <TableCell className="font-mono text-sm">{name}</TableCell>
                  <TableCell>
                    <Badge variant={process.env[name] ? "success" : "destructive"}>{process.env[name] ? "Yes" : "No"}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">Hosting:</span> Vercel
            </span>
            <span>
              <span className="font-medium text-foreground">Database:</span> Prisma Postgres
            </span>
            <span>
              <span className="font-medium text-foreground">Cron trigger:</span> GitHub Actions
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
