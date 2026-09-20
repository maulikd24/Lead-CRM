import crypto from "node:crypto";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/db/prisma";

/**
 * A dedicated, never-logged-into User row that inbound webhook-driven client creation attributes
 * itself to — createClientCore() requires a real actorUserId for AuditLog/Activity attribution and
 * initializeClient()'s side effects, and there is no authenticated human behind an inbound
 * Freshdesk/Exotel webhook. isActive: false fully blocks sign-in (checked in src/lib/auth/config.ts
 * at both initial authorize() and every session refresh), so this account is inert even though it
 * exists as a real row (visible, transparently, in Settings > Users).
 */
export const SYSTEM_ACTOR_EMAIL = "system@supportify.internal";

/**
 * Idempotent completion-check (not a mutex claimed before the work runs) — same self-healing
 * pattern as seedBaselineStages(): a transient failure partway through just means the next tick
 * tries again, rather than permanently "completing" having created nothing.
 */
export async function seedSystemActor() {
  const existing = await prisma.user.findUnique({ where: { email: SYSTEM_ACTOR_EMAIL }, select: { id: true } });
  if (existing) return { skipped: "already-seeded" as const };

  try {
    await prisma.user.create({
      data: {
        name: "System (Automated Intake)",
        email: SYSTEM_ACTOR_EMAIL,
        // Random, never-shared, never-used-to-authenticate hash — isActive: false is the real
        // safeguard; this just keeps the column in the same bcrypt shape every other User row has.
        passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10),
        role: "ADMIN",
        isActive: false,
      },
    });
    return { seeded: true as const };
  } catch (error) {
    console.error("Failed to seed system actor", error);
    return { error: "seed-failed" as const };
  }
}

export async function getSystemActorId(): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: SYSTEM_ACTOR_EMAIL } });
  return user.id;
}
