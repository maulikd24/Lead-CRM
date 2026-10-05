import { prisma } from "@/lib/db/prisma";
import { decryptJson } from "@/lib/security/crypto";
import { getDbDiagnostics } from "@/lib/system/db-diagnostics";
import { CRON_HEARTBEAT, HEARTBEAT_STALE_MS, getHeartbeatAgeMs } from "@/lib/system/heartbeat";
import { STAGE_DEFINITIONS } from "@/lib/stage-engine/stages";
import { ASSIGNMENT_MODE_LABELS } from "@/lib/assignment/modes";
import { formatDateTime } from "@/lib/utils/format";

export type CheckStatus = "pass" | "warn" | "fail";
export type CheckResult = { status: CheckStatus; message: string };

const pass = (message: string): CheckResult => ({ status: "pass", message });
const warn = (message: string): CheckResult => ({ status: "warn", message });
const fail = (message: string): CheckResult => ({ status: "fail", message });

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const LEAD_SOURCE_LABELS = ["Meta Ads", "Instagram Ads", "Google Ads", "Contact Form", "Website/Blog Post"];
const LIVE_PROVIDERS: { provider: string; label: string }[] = [
  { provider: "freshdesk", label: "Freshdesk" },
  { provider: "exotel", label: "Exotel" },
  { provider: "clevertap", label: "Clevertap" },
  { provider: "lead_intake", label: "Lead Sources" },
  { provider: "resend_email", label: "Resend email" },
];

type ConfigRow = { provider: string; mode: string; isEnabled: boolean; credentials: unknown };

function credentialsOf(row: ConfigRow | undefined): Record<string, unknown> {
  if (!row?.credentials) return {};
  try {
    return decryptJson<Record<string, unknown>>(row.credentials as string);
  } catch {
    return {};
  }
}

/** A live integration with its credentials (and webhook secret, where it has one) saved. */
function integrationCheck(row: ConfigRow | undefined, label: string, secretKey?: string): CheckResult {
  if (!row) return fail(`${label} has never been configured.`);
  if (row.mode !== "live") return fail(`${label} is in Mock mode — switch it to Live.`);
  if (!row.isEnabled) return fail(`${label} is switched Live but has no saved credentials.`);
  const credentials = credentialsOf(row);
  if (Object.values(credentials).every((v) => !v)) return fail(`${label} has no credentials saved.`);
  if (secretKey && !credentials[secretKey]) return fail(`${label} is Live but has no webhook secret — its webhooks will be rejected.`);
  return pass(`${label} is Live with credentials${secretKey ? " and a webhook secret" : ""}.`);
}

async function lastDelivery(source: string, label: string): Promise<CheckResult> {
  const row = await prisma.webhookDelivery.findFirst({ where: { source }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true } });
  if (!row) return fail(`No ${label} delivery recorded in the last 7 days.`);
  const ageHours = (Date.now() - row.receivedAt.getTime()) / HOUR;
  return ageHours > 72 ? warn(`Last ${label} delivery was ${formatDateTime(row.receivedAt)}.`) : pass(`Last ${label} delivery: ${formatDateTime(row.receivedAt)}.`);
}

/** Every automatic go-live check, computed from the running system. Keyed by checklist item id. */
export async function runAutoChecks(): Promise<Record<string, CheckResult>> {
  const now = Date.now();
  const [
    configs,
    heartbeatAge,
    dbDiag,
    activeStages,
    admins,
    rms,
    assignment,
    demoUsers,
    demoClients,
    demoHouseholds,
    failedRecent,
    failedStuck,
    leadsBySource,
    approvedTemplates,
    waConnected,
    pushTokens,
  ] = await Promise.all([
    prisma.integrationConfig.findMany({ select: { provider: true, mode: true, isEnabled: true, credentials: true } }),
    getHeartbeatAgeMs(CRON_HEARTBEAT).catch(() => null),
    getDbDiagnostics().catch(() => null),
    prisma.stage.count({ where: { isActive: true, name: { in: STAGE_DEFINITIONS.map((s) => s.name) } } }),
    prisma.user.count({ where: { role: "ADMIN", isActive: true } }),
    prisma.user.findMany({ where: { role: "RM", isActive: true }, select: { availabilityStatus: true, managerId: true } }),
    prisma.assignmentSettings.findFirst({ select: { mode: true } }),
    prisma.user.count({ where: { email: { endsWith: ".local" } } }),
    prisma.client.count({ where: { clientCode: { startsWith: "CL-DEMO" } } }),
    prisma.household.count({ where: { householdCode: { startsWith: "HH-DEMO" } } }),
    prisma.leadIntake.count({ where: { status: "ERROR", attempts: { lt: 5 } } }),
    prisma.leadIntake.count({ where: { status: "ERROR", attempts: { gte: 5 } } }),
    prisma.client.groupBy({ by: ["leadSource"], where: { leadSource: { in: LEAD_SOURCE_LABELS }, createdAt: { gte: new Date(now - 7 * DAY) } }, _count: { _all: true } }),
    prisma.messageTemplate.count({ where: { approved: true } }),
    prisma.whatsAppAccount.count({ where: { isActive: true, status: "CONNECTED" } }),
    prisma.pushToken.count(),
  ]);
  const byProvider = new Map(configs.map((c) => [c.provider, c as ConfigRow]));
  const results: Record<string, CheckResult> = {};

  // --- environment
  const problems: string[] = [];
  for (const name of ["DATABASE_URL", "DIRECT_DATABASE_URL", "CRON_SECRET"]) if (!process.env[name]) problems.push(`${name} is missing`);
  if (!process.env.AUTH_SECRET && !process.env.NEXTAUTH_SECRET) problems.push("no auth secret (AUTH_SECRET) is set");
  if (!/^[0-9a-f]{64}$/i.test(process.env.ENCRYPTION_KEY ?? "")) problems.push("ENCRYPTION_KEY must be 64 hex characters");
  const url = process.env.NEXTAUTH_URL ?? "";
  if (!url) problems.push("NEXTAUTH_URL is missing");
  else if (!url.startsWith("https://") || url.includes("localhost")) problems.push("NEXTAUTH_URL must be your https production domain");
  results["env-core"] = problems.length ? fail(problems.join("; ") + ".") : url.includes("vercel.app") ? warn("All set, but NEXTAUTH_URL is still a vercel.app address — fine only if you are not using a custom domain.") : pass("All core variables are set.");

  // --- migrations
  const migrations = dbDiag?.recentMigrations;
  if (!migrations) results["db-migrations"] = fail(dbDiag?.error ? `Could not read migration status: ${dbDiag.error}` : "Could not read migration status.");
  else {
    const latest = migrations[0];
    results["db-migrations"] = !latest ? warn("No migration history found.") : migrations.some((m) => m.rolledBackAt) ? fail("A recent migration was rolled back.") : latest.finishedAt ? pass(`Latest migration ${latest.name} finished.`) : fail(`Migration ${latest.name} has not finished.`);
  }

  // --- scheduler
  results["cron-heartbeat"] =
    heartbeatAge === null ? fail("The scheduler has never ticked.") : heartbeatAge > HEARTBEAT_STALE_MS ? fail(`Last tick was ${Math.round(heartbeatAge / 60000)} minutes ago — the scheduler is late or stopped.`) : pass(`Last tick ${Math.round(heartbeatAge / 60000)} minute(s) ago.`);
  results["report-emails"] = process.env.DAILY_REPORT_RECIPIENT_EMAIL ? pass("Recipient is set.") : fail("DAILY_REPORT_RECIPIENT_EMAIL is not set — no management reports will be sent.");
  results["stages-seeded"] = activeStages === STAGE_DEFINITIONS.length ? pass("All six stages are active.") : fail(`${activeStages} of ${STAGE_DEFINITIONS.length} onboarding stages are active.`);

  // --- leads
  results["failed-leads"] = failedStuck > 0 ? fail(`${failedStuck} lead(s) failed after 5 attempts and need a human look.`) : failedRecent > 0 ? warn(`${failedRecent} lead(s) are waiting for an automatic retry.`) : pass("No failed lead submissions.");
  const notLive = LIVE_PROVIDERS.filter((p) => byProvider.get(p.provider)?.mode !== "live").map((p) => p.label);
  results["mock-modes"] = notLive.length ? fail(`Not Live yet: ${notLive.join(", ")}.`) : pass("All integrations are Live.");
  results["leadsrc-config"] = (() => {
    const row = byProvider.get("lead_intake");
    const base = integrationCheck(row, "Lead Sources");
    if (base.status !== "pass") return base;
    const c = credentialsOf(row);
    const missing = [!c.webSecret && !c.webFormKey ? "website" : "", !c.googleKey ? "Google" : "", !c.metaAppSecret || !c.metaVerifyToken || !c.metaPageToken ? "Meta" : ""].filter(Boolean);
    return missing.length ? warn(`Live, but credentials are missing for: ${missing.join(", ")}.`) : pass("Live with website, Google and Meta credentials.");
  })();
  results["leadsrc-traffic"] = (() => {
    const counts = new Map(leadsBySource.map((r) => [r.leadSource ?? "", r._count._all]));
    const summary = LEAD_SOURCE_LABELS.map((l) => `${l}: ${counts.get(l) ?? 0}`).join(" · ");
    const zero = LEAD_SOURCE_LABELS.filter((l) => !counts.get(l));
    return zero.length === LEAD_SOURCE_LABELS.length ? fail(`No leads from any ad/form source in 7 days. ${summary}`) : zero.length ? warn(`${summary}`) : pass(summary);
  })();

  // --- integrations
  results["freshdesk-config"] = integrationCheck(byProvider.get("freshdesk"), "Freshdesk", "webhookSecret");
  results["freshdesk-traffic"] = await lastDelivery("freshdesk", "Freshdesk");
  results["exotel-config"] = integrationCheck(byProvider.get("exotel"), "Exotel", "webhookSecret");
  results["exotel-traffic"] = await lastDelivery("exotel", "Exotel");
  const ct = integrationCheck(byProvider.get("clevertap"), "Clevertap", "webhookSecret");
  results["clevertap-config"] = ct;
  results["resend-config"] = integrationCheck(byProvider.get("resend_email"), "Resend");

  // --- people & routing
  results["admins-two"] = admins >= 2 ? pass(`${admins} active Admins.`) : fail(`Only ${admins} active Admin — add a second.`);
  const available = rms.filter((r) => r.availabilityStatus === "AVAILABLE");
  const noManager = rms.filter((r) => !r.managerId).length;
  results["rm-ready"] = available.length === 0 ? fail("No available RM — new leads will be unassigned.") : noManager > 0 ? warn(`${available.length} available RM(s), but ${noManager} RM(s) have no manager (escalations have nowhere to go).`) : pass(`${available.length} available RM(s), all with a manager.`);
  results["assignment-mode"] = assignment ? pass(`Current mode: ${ASSIGNMENT_MODE_LABELS[assignment.mode].label}. Confirm it is deliberate.`) : warn("Never set — defaults to Load-based. Confirm it is deliberate.");
  results["demo-users"] = demoUsers ? fail(`${demoUsers} account(s) with a .local email address (demo/seed).`) : pass("No .local demo accounts.");
  results["demo-data"] = demoClients || demoHouseholds ? fail(`${demoClients} demo client(s) and ${demoHouseholds} demo household(s) still exist.`) : pass("No demo clients or households.");
  const kyc = process.env.KYC_AUTOMATION_PROVIDER;
  results["kyc-provider"] = !kyc ? pass("Unset — every KYC step is verified manually.") : kyc === "mock" ? fail("Set to the mock provider.") : pass(`Using provider "${kyc}".`);

  // --- messaging & mobile
  results["templates-approved"] = approvedTemplates > 0 ? pass(`${approvedTemplates} approved template(s).`) : warn("No approved templates yet.");
  results["wa-inbox"] = waConnected > 0 ? pass(`${waConnected} WhatsApp number(s) connected.`) : warn("No WhatsApp number connected (ignore if you are not launching the Inbox).");
  results["push-config"] = !process.env.FIREBASE_SERVICE_ACCOUNT_JSON ? warn("FIREBASE_SERVICE_ACCOUNT_JSON is not set — no phone push.") : pushTokens === 0 ? warn("Configured, but no phone has registered yet.") : pass(`${pushTokens} phone(s) registered.`);
  results["ai-keys"] = process.env.OPENAI_API_KEY && process.env.ANTHROPIC_API_KEY ? pass("Both keys are set.") : warn(`Missing: ${[!process.env.OPENAI_API_KEY && "OPENAI_API_KEY (summaries)", !process.env.ANTHROPIC_API_KEY && "ANTHROPIC_API_KEY (Quality Audit)"].filter(Boolean).join(", ")}.`);

  return results;
}
