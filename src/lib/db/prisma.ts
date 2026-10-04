import { cache } from "react";

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  basePrisma: PrismaClient | undefined;
};

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

/** Un-extended client. Used by the activity logger itself (so logging can't recurse) and nowhere else. */
export const basePrisma = globalForPrisma.basePrisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.basePrisma = basePrisma;

// --- Central capture of every data change made by a signed-in user (UserEvent feed) -------------

const TRACKED_OPERATIONS = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);

// Log/system tables: tracking these would be circular or pure noise.
const UNTRACKED_MODELS = new Set(["UserEvent", "LoginAttempt", "DataAccessLog", "AuditLog", "Notification", "DailyJobRun", "WebhookDelivery", "RateLimitCounter"]);

// Writes touching ONLY these fields are system bookkeeping, not a user "doing" something: the sign-in flow's
// counters, and the round-robin cursor that advances on every auto-assigned lead.
const BOOKKEEPING_FIELDS: Record<string, Set<string>> = {
  User: new Set(["lastLoginAt", "failedLoginAttempts", "lockedUntil"]),
  AssignmentSettings: new Set(["roundRobinCursorId"]),
};

type Actor = { id: string; role: import("@/generated/prisma/client").Role; email: string };

// auth() runs the JWT callback (a DB lookup) on every call, so share one result per request.
// Dynamic import avoids the config.ts <-> prisma.ts import cycle. Outside a request (cron, webhooks,
// seeds) auth() throws or returns null -> no actor -> the write is simply not attributed/recorded.
const getActor = cache(async (): Promise<Actor | null> => {
  try {
    const { auth } = await import("@/lib/auth/config");
    const session = await auth();
    if (!session?.user?.id) return null;
    return { id: session.user.id, role: session.user.role, email: session.user.email };
  } catch {
    return null;
  }
});

function fieldNames(args: unknown, operation: string): string[] {
  const a = (args ?? {}) as { data?: unknown; create?: unknown; update?: unknown };
  const sources: unknown[] = operation === "upsert" ? [a.update, a.create] : [a.data];
  const names = new Set<string>();
  for (const source of sources) {
    const rows = Array.isArray(source) ? source.slice(0, 5) : [source];
    for (const row of rows) {
      if (row && typeof row === "object") Object.keys(row).forEach((k) => names.add(k));
    }
  }
  return [...names].slice(0, 30);
}

const VERB: Record<string, { type: "DATA_CREATE" | "DATA_UPDATE" | "DATA_DELETE"; label: string }> = {
  create: { type: "DATA_CREATE", label: "Created" },
  createMany: { type: "DATA_CREATE", label: "Created" },
  update: { type: "DATA_UPDATE", label: "Updated" },
  updateMany: { type: "DATA_UPDATE", label: "Updated" },
  upsert: { type: "DATA_UPDATE", label: "Saved" },
  delete: { type: "DATA_DELETE", label: "Deleted" },
  deleteMany: { type: "DATA_DELETE", label: "Deleted" },
};

// Phone push for every Notification row, wherever it is created (cron jobs, server actions, webhooks) —
// one hook instead of editing ~29 call sites. No-op unless Firebase (or PUSH_DRY_RUN) is configured.
async function dispatchPush(notification: { userId: string; type: string; payload: unknown }) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON && process.env.PUSH_DRY_RUN !== "1") return;
  try {
    const { pushForNotification } = await import("@/lib/push/send-push");
    const run = () => pushForNotification(notification);
    try {
      // Keeps the send alive after the response on serverless; throws when there is no request scope.
      const { after } = await import("next/server");
      after(run);
    } catch {
      await Promise.race([run(), new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
  } catch (error) {
    console.error("Push dispatch failed", error);
  }
}

export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const result = await query(args);
        if (model === "Notification" && operation === "create") {
          const row = result as { userId: string; type: string; payload: unknown };
          await dispatchPush(row);
          return result;
        }
        if (!TRACKED_OPERATIONS.has(operation) || UNTRACKED_MODELS.has(model)) return result;

        try {
          const fields = fieldNames(args, operation);
          const bookkeeping = BOOKKEEPING_FIELDS[model];
          if (bookkeeping && fields.length > 0 && fields.every((f) => bookkeeping.has(f))) return result;

          const actor = await getActor();
          if (!actor) return result;

          const verb = VERB[operation];
          const isMany = operation.endsWith("Many");
          const record = result as { id?: unknown; count?: unknown } | null;
          const { logUserEvent } = await import("@/lib/activity/log-user-event");
          // Fire-and-forget: never delay or fail the user's own write.
          void logUserEvent({
            userId: actor.id,
            userEmail: actor.email,
            userRole: actor.role,
            type: verb.type,
            entity: model,
            entityId: !isMany && typeof record?.id === "string" ? record.id : null,
            summary: `${verb.label} ${model}${isMany && typeof record?.count === "number" ? ` (${record.count} rows)` : ""}${
              fields.length ? `: ${fields.slice(0, 8).join(", ")}` : ""
            }`,
            details: { operation, fields, ...(isMany && typeof record?.count === "number" ? { count: record.count } : {}) },
          });
        } catch (error) {
          console.error("User activity capture failed", error);
        }
        return result;
      },
    },
  },
});
