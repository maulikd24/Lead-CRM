import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  CRM_BASE_URL: z.string().url("CRM_BASE_URL must be a full URL, e.g. https://your-crm.vercel.app"),
  WHATSAPP_WORKER_SECRET: z.string().min(16, "WHATSAPP_WORKER_SECRET must be at least 16 characters (use `openssl rand -hex 32`)"),
  // Comma-separated Openwa session ids; each must match a WhatsApp Account's Session ID in the CRM.
  SESSION_IDS: z.string().min(1, "SESSION_IDS is required, e.g. rm_1,rm_2,rm_3,rm_4"),
  SESSION_DATA_DIR: z.string().default("./data/sessions"),
  START_STAGGER_MS: z.coerce.number().int().min(0).default(20_000),
  OUTBOX_POLL_MS: z.coerce.number().int().min(500).default(2_000),
  HEARTBEAT_MS: z.coerce.number().int().min(5_000).default(30_000),
  HEALTH_CHECK_MS: z.coerce.number().int().min(10_000).default(60_000),
  SEND_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(1_500),
  // Drops messages older than this on arrival, so a first-time link's history sync can't create stale leads. 0 = keep everything.
  MAX_MESSAGE_AGE_SECONDS: z.coerce.number().int().min(0).default(900),
  CHROME_PATH: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid worker configuration:");
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

const env = parsed.data;
const sessionIds = env.SESSION_IDS.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

for (const id of sessionIds) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    console.error(`Invalid session id "${id}": letters, numbers, - and _ only, no spaces.`);
    process.exit(1);
  }
}
if (new Set(sessionIds).size !== sessionIds.length) {
  console.error("SESSION_IDS contains duplicates.");
  process.exit(1);
}

export const config = {
  crmBaseUrl: env.CRM_BASE_URL.replace(/\/+$/, ""),
  secret: env.WHATSAPP_WORKER_SECRET,
  sessionIds,
  sessionDataDir: env.SESSION_DATA_DIR,
  startStaggerMs: env.START_STAGGER_MS,
  outboxPollMs: env.OUTBOX_POLL_MS,
  heartbeatMs: env.HEARTBEAT_MS,
  healthCheckMs: env.HEALTH_CHECK_MS,
  sendMinIntervalMs: env.SEND_MIN_INTERVAL_MS,
  maxMessageAgeSeconds: env.MAX_MESSAGE_AGE_SECONDS,
  chromePath: env.CHROME_PATH,
  logLevel: env.LOG_LEVEL,
} as const;
