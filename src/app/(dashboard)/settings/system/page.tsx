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
import { getDbDiagnostics } from "@/lib/system/db-diagnostics";
import Link from "next/link";

// Only these 5 of the 16 cron jobs persist a queryable run history via DailyJobRun (confirmed via
// grep — the rest use other idempotency mechanisms with no "last ran at" to show). Keep this list in
// sync with src/app/api/internal/cron/tick/route.ts if jobs are added/removed/renamed.
const DAILY_JOB_RUN_JOBS = [
  "daily_leads_report",
  "weekly_management_report",
  "monthly_management_report",
  "seed_distribution_os_demo",
  "audit_chain_verify",
] as const;

const CRON_JOBS: { name: string; description: string; cadence: string; dailyJobRunName?: (typeof DAILY_JOB_RUN_JOBS)[number] }[] = [
  { name: "checkOverdueTasks", description: "Flips Task.status to OVERDUE past its due date", cadence: "Every tick (~5 min)" },
  { name: "checkStageSla", description: "Warns the RM when a client nears its stage SLA, and notifies the RM/manager on breach", cadence: "Every tick (~5 min)" },
  { name: "checkFundingSla", description: "Follow-up task + escalation for funding stuck pending", cadence: "Every tick (~5 min)" },
  { name: "processDueJourneySteps", description: "Advances due Journey automation steps", cadence: "Every tick (~5 min)" },
  { name: "checkDisengagement", description: "Flags clients with no recent activity", cadence: "Every tick (~5 min)" },
  { name: "checkWhatsAppAccountHealth", description: "Marks WhatsApp numbers offline when the worker heartbeat stops (5 min) and notifies Admins", cadence: "Every tick (~5 min)" },
  { name: "sendDailyReportEmail", description: "Org-wide leads-activity digest email", cadence: "Once daily, ~9 PM IST", dailyJobRunName: "daily_leads_report" },
  { name: "sendWeeklyManagementReport", description: "Weekly management summary email", cadence: "Mondays, ~9 PM IST", dailyJobRunName: "weekly_management_report" },
  { name: "sendMonthlyManagementReport", description: "Monthly management summary email", cadence: "1st of the month, ~9 PM IST", dailyJobRunName: "monthly_management_report" },
  { name: "seedDistributionOsDemoData", description: "One-time production demo-data seed", cadence: "One-time", dailyJobRunName: "seed_distribution_os_demo" },
  { name: "seedBaselineStages", description: "Idempotent upsert of the 6 onboarding stages", cadence: "Every tick, self-healing completion-check" },
  { name: "seedSystemActor", description: "Idempotent seed of the webhook system actor account", cadence: "Every tick, self-healing completion-check" },
  { name: "backfillCompletedClientsToFinalStage", description: "Moves legacy-completed clients onto the real final stage", cadence: "Every tick, no-op once caught up" },
  { name: "checkStaleVoiceAnalysis", description: "Marks a call's quality-audit review FAILED if Exotel's transcript callback never arrives", cadence: "Every tick (~5 min)" },
  { name: "sweepWhatsAppConversationReviews", description: "Finds WhatsApp threads with new activity and runs sentiment/quality-audit analysis on them", cadence: "Every tick (~5 min)" },
  { name: "runDailyAuditChainCheck", description: "Recomputes the AuditLog hash chain and alerts Admins if any entry was edited or removed", cadence: "Once daily", dailyJobRunName: "audit_chain_verify" },
];

// Presence-only checks — never render an actual value on this page, only whether it's set. Most are
// a single required var; Blob storage can be configured either way depending on how the store was
// connected (a static token, or — as this project's is — OIDC + a store id), so it's "configured" if
// either is present.
const ENV_VARS: { label: string; anyOf: string[] }[] = [
  { label: "DATABASE_URL", anyOf: ["DATABASE_URL"] },
  { label: "DIRECT_DATABASE_URL", anyOf: ["DIRECT_DATABASE_URL"] },
  { label: "ENCRYPTION_KEY", anyOf: ["ENCRYPTION_KEY"] },
  { label: "CRON_SECRET", anyOf: ["CRON_SECRET"] },
  { label: "NEXTAUTH_URL", anyOf: ["NEXTAUTH_URL"] },
  { label: "META_WEBHOOK_VERIFY_TOKEN", anyOf: ["META_WEBHOOK_VERIFY_TOKEN"] },
  { label: "DAILY_REPORT_RECIPIENT_EMAIL", anyOf: ["DAILY_REPORT_RECIPIENT_EMAIL"] },
  { label: "WHATSAPP_WORKER_SECRET", anyOf: ["WHATSAPP_WORKER_SECRET"] },
  { label: "BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID", anyOf: ["BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID"] },
  { label: "ANTHROPIC_API_KEY", anyOf: ["ANTHROPIC_API_KEY"] },
  { label: "FIREBASE_SERVICE_ACCOUNT_JSON (phone push)", anyOf: ["FIREBASE_SERVICE_ACCOUNT_JSON"] },
  { label: "OPENAI_API_KEY (AI summaries)", anyOf: ["OPENAI_API_KEY"] },
];

const OTHER_API_ROUTES = [
  "/api/internal/cron/tick",
  "/api/device/call-log",
  "/api/internal/whatsapp/events",
  "/api/internal/whatsapp/outbox",
  "/api/internal/whatsapp/outbox/[id]/result",
  "/api/auth/[...nextauth]",
  "/api/clients/export",
  "/api/reports/summary-pdf",
  "/api/reports/management-dashboard-pdf",
  "/api/reports/rm-daily-report",
  "/api/reports/leads-summary",
  "/api/internal/exotel/voice-analyze-callback",
];

export default async function SystemOverviewPage() {
  await requireRole(["ADMIN"]);

  const messagingProviders = MESSAGING_CHANNELS.map((c) => messagingProviderKeyFor(c));
  const allProviders = [...INTEGRATION_PROVIDERS, ...messagingProviders, ...EMAIL_PROVIDERS];

  const [dbDiagnostics, configs, dailyJobRuns] = await Promise.all([
    getDbDiagnostics(),
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
          <CardTitle className="text-base">Database</CardTitle>
          <CardDescription>
            Which database this running app is connected to and the state of its migrations. Hosts, names and a short
            hash only — no credentials.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {dbDiagnostics.error && <p className="text-sm text-destructive">Diagnostics query failed: {dbDiagnostics.error}</p>}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Connection</TableHead>
                <TableHead>Host</TableHead>
                <TableHead>Database</TableHead>
                <TableHead>Credentials hash</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody striped>
              {([["DATABASE_URL (app runtime)", dbDiagnostics.runtime], ["DIRECT_DATABASE_URL (migrations at build)", dbDiagnostics.direct]] as const).map(([label, u]) => (
                <TableRow key={label}>
                  <TableCell className="text-sm">{label}</TableCell>
                  <TableCell className="font-mono text-xs">{u.configured ? (u.host ?? "unparseable") : "not set"}</TableCell>
                  <TableCell className="font-mono text-xs">{u.database ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{u.credentialsFingerprint ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="text-muted-foreground">
              Connected database: <span className="font-mono text-foreground">{dbDiagnostics.connectedDatabase ?? "—"}</span>
            </span>
            <span className="flex items-center gap-2 text-muted-foreground">
              WhatsAppAccount table:
              <Badge variant={dbDiagnostics.whatsappTableExists ? "success" : "destructive"}>
                {dbDiagnostics.whatsappTableExists === null ? "Unknown" : dbDiagnostics.whatsappTableExists ? "Present" : "Missing"}
              </Badge>
            </span>
            {dbDiagnostics.direct.configured && (
              <span className="flex items-center gap-2 text-muted-foreground">
                Runtime and migration credentials:
                {/* Different is expected (and safer) once the app runs as the restricted role — see scripts/db/setup-app-role.mjs */}
                <Badge variant={dbDiagnostics.runtime.credentialsFingerprint === dbDiagnostics.direct.credentialsFingerprint || dbDiagnostics.auditProtection?.canTamper === false ? "success" : "destructive"}>
                  {dbDiagnostics.runtime.credentialsFingerprint === dbDiagnostics.direct.credentialsFingerprint ? "Same" : "Different"}
                </Badge>
              </span>
            )}
            {dbDiagnostics.auditProtection && (
              <span className="flex items-center gap-2 text-muted-foreground">
                Audit log protection:
                <Badge variant={dbDiagnostics.auditProtection.canTamper ? "warning" : "success"}>
                  {dbDiagnostics.auditProtection.canTamper ? "Triggers only" : "Restricted app role"}
                </Badge>
                <span className="font-mono text-xs">{dbDiagnostics.auditProtection.role}</span>
              </span>
            )}
          </div>
          {dbDiagnostics.recentMigrations && (
            <div>
              <p className="mb-1 text-sm font-medium">Latest migrations recorded</p>
              <div className="flex flex-col gap-1 font-mono text-xs text-muted-foreground">
                {dbDiagnostics.recentMigrations.map((m) => (
                  <span key={m.name}>
                    {m.name} — {m.rolledBackAt ? "rolled back" : m.finishedAt ? `applied ${formatDateTime(m.finishedAt)}` : "not finished"}
                  </span>
                ))}
              </div>
            </div>
          )}
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
              {ENV_VARS.map(({ label, anyOf }) => {
                const configured = anyOf.some((name) => process.env[name]);
                return (
                  <TableRow key={label}>
                    <TableCell className="font-mono text-sm">{label}</TableCell>
                    <TableCell>
                      <Badge variant={configured ? "success" : "destructive"}>{configured ? "Yes" : "No"}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
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
