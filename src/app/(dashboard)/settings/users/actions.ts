"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { pickAssignee } from "@/lib/assignment/routing-engine";
import type { AvailabilityStatus, Role } from "@/generated/prisma/client";

const createUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email(),
  role: z.enum(["ADMIN", "MANAGER", "RM", "DEALER"]),
  managerId: z.string().optional().or(z.literal("")),
  capacity: z.coerce.number().int().positive().optional(),
});

function generateTempPassword(): string {
  return randomBytes(9).toString("base64url"); // 12-char URL-safe temp password
}

export async function createUserAction(formData: FormData) {
  await requireRole(["ADMIN"]);

  const parsed = createUserSchema.parse({
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    managerId: formData.get("managerId"),
    capacity: formData.get("capacity") || undefined,
  });

  const existing = await prisma.user.findUnique({ where: { email: parsed.email } });
  if (existing) throw new Error("A user with this email already exists");

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  await prisma.user.create({
    data: {
      name: parsed.name,
      email: parsed.email,
      role: parsed.role,
      passwordHash,
      managerId: parsed.managerId || null,
      capacity: parsed.capacity ?? null,
    },
  });

  revalidatePath("/settings/users");
  return { tempPassword };
}

export async function setUserRoleAction(userId: string, role: Role) {
  await requireRole(["ADMIN"]);

  await prisma.user.update({ where: { id: userId }, data: { role } });

  revalidatePath("/settings/users");
}

export async function setUserManagerAction(userId: string, managerId: string | null) {
  await requireRole(["ADMIN"]);

  if (managerId === userId) throw new Error("A user cannot be their own manager");

  await prisma.user.update({ where: { id: userId }, data: { managerId } });

  revalidatePath("/settings/users");
}

export async function setUserActiveAction(userId: string, isActive: boolean) {
  const session = await requireRole(["ADMIN"]);

  if (userId === session.user.id && !isActive) {
    throw new Error("You cannot deactivate your own account");
  }

  await prisma.user.update({ where: { id: userId }, data: { isActive } });

  revalidatePath("/settings/users");
}

export async function setUserCapacityAction(userId: string, capacity: number | null) {
  await requireRole(["ADMIN"]);

  await prisma.user.update({ where: { id: userId }, data: { capacity } });

  revalidatePath("/settings/users");
  revalidatePath("/reports");
}

export async function setUserRoutingTagsAction(
  userId: string,
  input: { regions: string[]; languages: string[]; handlesHni: boolean },
) {
  await requireRole(["ADMIN", "MANAGER"]);

  await prisma.user.update({
    where: { id: userId },
    data: { regions: input.regions, languages: input.languages, handlesHni: input.handlesHni },
  });

  revalidatePath("/settings/users");
}

export type ReassignmentSummary = {
  clientId: string;
  clientName: string;
  newRmId: string | null;
  newRmName?: string;
};

export async function setUserAvailabilityAction(
  userId: string,
  status: AvailabilityStatus,
): Promise<{ reassigned: ReassignmentSummary[] }> {
  const session = await requireRole(["ADMIN", "MANAGER"]);

  const rm = await prisma.user.update({ where: { id: userId }, data: { availabilityStatus: status } });
  revalidatePath("/settings/users");

  if (status === "AVAILABLE") {
    return { reassigned: [] };
  }

  // RM went On Leave / Unavailable — bulk-reassign their active book through the routing engine.
  const activeClients = await prisma.client.findMany({
    where: { assignedToId: userId, status: "ACTIVE", mergedIntoId: null },
    select: {
      id: true,
      name: true,
      clientType: true,
      expectedInvestment: true,
      region: true,
      preferredLanguage: true,
    },
  });

  const results: ReassignmentSummary[] = [];
  // Sequential, not parallel — pickAssignee reads live active-client counts that must reflect
  // prior reassignments made earlier in this same batch to stay load-balanced.
  for (const client of activeClients) {
    const pick = await pickAssignee(client);
    if (pick.assignedToId) {
      await prisma.$transaction([
        prisma.client.update({ where: { id: client.id }, data: { assignedToId: pick.assignedToId } }),
        prisma.auditLog.create({
          data: {
            userId: session.user.id,
            entity: "Client",
            entityId: client.id,
            action: "auto_reassigned",
            oldValue: { assignedToId: userId },
            newValue: { assignedToId: pick.assignedToId },
            reason: `${rm.name} marked ${status}`,
          },
        }),
        // Pushed directly (not via logActivity()) to stay a PrismaPromise batched into this
        // $transaction array — an async wrapper would return a plain Promise instead.
        prisma.activity.create({
          data: {
            clientId: client.id,
            userId: session.user.id,
            type: "NOTE",
            payload: { message: `Auto-reassigned to ${pick.rmName} (${rm.name} marked ${status})` },
          },
        }),
      ]);
      results.push({ clientId: client.id, clientName: client.name, newRmId: pick.assignedToId, newRmName: pick.rmName });
    } else {
      // No eligible RM — actually unassign (not just leave parked on the now-unavailable RM), so
      // it surfaces the same way a failed auto-assignment at creation time does.
      const managers = await prisma.user.findMany({
        where: { isActive: true, role: { in: ["MANAGER", "ADMIN"] } },
        select: { id: true },
      });
      await prisma.$transaction([
        prisma.client.update({ where: { id: client.id }, data: { assignedToId: null } }),
        prisma.auditLog.create({
          data: {
            userId: session.user.id,
            entity: "Client",
            entityId: client.id,
            action: "auto_assign_failed",
            oldValue: { assignedToId: userId },
            newValue: { assignedToId: null },
            reason: `${rm.name} marked ${status}; no eligible RM found for reassignment`,
          },
        }),
        prisma.activity.create({
          data: {
            clientId: client.id,
            userId: session.user.id,
            type: "NOTE",
            payload: { message: `Unassigned — ${rm.name} marked ${status}; no eligible RM found for reassignment` },
          },
        }),
        ...managers.map((m) =>
          prisma.notification.create({
            data: {
              userId: m.id,
              type: "new_assignment",
              payload: { clientId: client.id, clientName: client.name, reason: "no_eligible_rm" },
            },
          }),
        ),
      ]);
      results.push({ clientId: client.id, clientName: client.name, newRmId: null });
    }
  }

  revalidatePath("/clients");
  return { reassigned: results };
}

const resetPasswordSchema = z.object({
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

export async function resetUserPasswordAction(userId: string, newPassword: string) {
  await requireRole(["ADMIN"]);

  const parsed = resetPasswordSchema.parse({ newPassword });
  const passwordHash = await bcrypt.hash(parsed.newPassword, 10);

  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

  revalidatePath("/settings/users");
}
