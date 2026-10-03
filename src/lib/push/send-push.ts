import { basePrisma } from "@/lib/db/prisma";
import { describeNotification, notificationCategory, notificationUrl, type NotificationCategory } from "@/lib/notifications/describe";

// Phone push via Firebase Cloud Messaging. Everything here degrades quietly: no credentials -> no-op, any
// failure -> logged and swallowed, so a push problem can never break the action that created a notification.
// PUSH_DRY_RUN=1 logs the message instead of sending (local verification without a Firebase project).

const TITLES: Record<string, string> = {
  stage_sla_due_soon: "SLA about to breach",
  stage_sla_breach: "SLA breached",
  funding_sla_pending_escalation: "Funding overdue",
  task_overdue: "Task overdue",
  task_overdue_escalation: "Team task overdue",
  new_assignment: "New client assigned",
  unassigned_lead: "Lead needs an RM",
  inbound_message: "New WhatsApp message",
  document_rejected: "Document rejected",
  kyc_update: "KYC update",
  kyc_approval_pending: "KYC awaiting approval",
  quality_review_low_score: "Low call-quality score",
};

export function isPushEnabled(): boolean {
  return !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.PUSH_DRY_RUN === "1";
}

type Messaging = import("firebase-admin/messaging").Messaging;
let cachedMessaging: Messaging | null = null;

async function getFirebaseMessaging(): Promise<Messaging | null> {
  if (cachedMessaging) return cachedMessaging;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const { cert, getApps, initializeApp } = await import("firebase-admin/app");
  const { getMessaging } = await import("firebase-admin/messaging");
  // Accept the raw JSON or a base64 copy of it (easier to paste into some env UIs).
  const json = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const app = getApps()[0] ?? initializeApp({ credential: cert(JSON.parse(json)) });
  cachedMessaging = getMessaging(app);
  return cachedMessaging;
}

export type PushMessage = { title: string; body: string; url: string };

/** Sends one message to every registered phone of a user. Returns counts; never throws. */
export async function sendPushToUser(userId: string, message: PushMessage): Promise<{ sent: number; failed: number }> {
  try {
    const tokens = await basePrisma.pushToken.findMany({ where: { userId }, select: { id: true, token: true } });
    if (tokens.length === 0) return { sent: 0, failed: 0 };

    if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      console.log("[push dry-run]", { userId, devices: tokens.length, ...message });
      return { sent: tokens.length, failed: 0 };
    }

    const messaging = await getFirebaseMessaging();
    if (!messaging) return { sent: 0, failed: 0 };
    const response = await messaging.sendEachForMulticast({
      tokens: tokens.map((t) => t.token),
      notification: { title: message.title, body: message.body },
      data: { url: message.url },
      android: { priority: "high", notification: { channelId: "alerts" } },
    });

    // Drop tokens FCM says are dead (app uninstalled / token rotated) so we stop trying them.
    const dead: string[] = [];
    response.responses.forEach((r, i) => {
      const code = r.error?.code;
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") dead.push(tokens[i].id);
    });
    if (dead.length > 0) await basePrisma.pushToken.deleteMany({ where: { id: { in: dead } } });

    return { sent: response.successCount, failed: response.failureCount };
  } catch (error) {
    console.error("Push send failed", error);
    return { sent: 0, failed: 0 };
  }
}

/** Called for every Notification row that gets created (see the extension in src/lib/db/prisma.ts). */
export async function pushForNotification(notification: { userId: string; type: string; payload: unknown }) {
  try {
    const category: NotificationCategory = notificationCategory(notification.type);
    const user = await basePrisma.user.findUnique({ where: { id: notification.userId }, select: { isActive: true, pushMutedCategories: true } });
    if (!user?.isActive || user.pushMutedCategories.includes(category)) return;

    const asNotification = { type: notification.type, payload: notification.payload } as Parameters<typeof describeNotification>[0];
    await sendPushToUser(notification.userId, {
      title: TITLES[notification.type] ?? "Supportify",
      body: describeNotification(asNotification).slice(0, 180),
      url: notificationUrl(asNotification),
    });
  } catch (error) {
    console.error("pushForNotification failed", error);
  }
}
