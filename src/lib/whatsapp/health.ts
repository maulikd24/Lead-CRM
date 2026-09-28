import { prisma } from "@/lib/db/prisma";

const HEARTBEAT_LOST_AFTER_MS = 5 * 60 * 1000;

/**
 * The worker heartbeats every ~30s. An account still marked live whose heartbeat stopped >5 minutes
 * ago means the worker (or its host) is down: flip it to DISCONNECTED so the inbox stops offering
 * sends, and tell the Admins once (the status flip is what makes it once — the next tick no longer
 * matches the query).
 */
export async function checkWhatsAppAccountHealth() {
  const cutoff = new Date(Date.now() - HEARTBEAT_LOST_AFTER_MS);
  const stale = await prisma.whatsAppAccount.findMany({
    where: { isActive: true, status: { in: ["CONNECTED", "CONNECTING", "QR_PENDING"] }, lastSeenAt: { lt: cutoff } },
  });
  if (stale.length === 0) return { markedOffline: 0 };

  const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });

  for (const account of stale) {
    await prisma.whatsAppAccount.update({
      where: { id: account.id },
      data: { status: "DISCONNECTED", lastError: "Worker heartbeat lost", qrDataUrl: null, qrUpdatedAt: null },
    });
    await Promise.all(
      admins.map((admin) =>
        prisma.notification.create({
          data: { userId: admin.id, type: "whatsapp_offline", payload: { accountLabel: account.label } },
        }),
      ),
    );
  }
  return { markedOffline: stale.length };
}
