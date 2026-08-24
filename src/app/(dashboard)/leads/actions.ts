"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { logActivity } from "@/lib/activities/log-activity";
import { onEvent } from "@/lib/journeys/dispatch";
import { sendMessage } from "@/lib/messaging/send";
import type { LeadStatus } from "@/generated/prisma/client";

const leadSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  source: z.string().optional().or(z.literal("")),
  assignedToId: z.string().optional().or(z.literal("")),
});

export async function createLeadAction(formData: FormData) {
  const session = await requireUser();

  const parsed = leadSchema.parse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    source: formData.get("source"),
    assignedToId: formData.get("assignedToId"),
  });

  const lead = await prisma.lead.create({
    data: {
      name: parsed.name,
      email: parsed.email || null,
      phone: parsed.phone || null,
      source: parsed.source || "manual",
      assignedToId: parsed.assignedToId || session.user.id,
    },
  });

  await logActivity({
    leadId: lead.id,
    userId: session.user.id,
    type: "NOTE",
    payload: { message: "Lead created" },
  });

  await onEvent("lead_created", lead.id);

  revalidatePath("/leads");
  return lead;
}

export async function updateLeadStatusAction(leadId: string, status: LeadStatus) {
  const session = await requireUser();

  const lead = await prisma.lead.update({ where: { id: leadId }, data: { status } });

  await logActivity({
    leadId,
    userId: session.user.id,
    type: "STATUS_CHANGE",
    payload: { status },
  });

  await onEvent("field_updated", leadId);

  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  return lead;
}

export async function reassignLeadAction(leadId: string, assignedToId: string) {
  const session = await requireUser();

  const lead = await prisma.lead.update({ where: { id: leadId }, data: { assignedToId } });

  const newOwner = await prisma.user.findUnique({ where: { id: assignedToId } });
  await logActivity({
    leadId,
    userId: session.user.id,
    type: "NOTE",
    payload: { message: `Reassigned to ${newOwner?.name ?? assignedToId}` },
  });

  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  return lead;
}

export async function addNoteAction(leadId: string, note: string) {
  const session = await requireUser();

  await logActivity({
    leadId,
    userId: session.user.id,
    type: "NOTE",
    payload: { message: note },
  });

  revalidatePath(`/leads/${leadId}`);
}

export async function convertLeadToContactAction(leadId: string) {
  const session = await requireUser();

  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

  const contact = await prisma.contact.create({
    data: {
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
    },
  });

  await prisma.lead.update({
    where: { id: leadId },
    data: { contactId: contact.id, status: "CONVERTED" },
  });

  await logActivity({
    leadId,
    userId: session.user.id,
    type: "STATUS_CHANGE",
    payload: { message: "Converted to contact", contactId: contact.id },
  });

  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/contacts");
  return contact;
}

export async function sendLeadMessageAction(
  leadId: string,
  channel: "whatsapp" | "sms",
  templateId: string,
  variables: Record<string, string>,
) {
  await requireUser();

  const message = await sendMessage({ leadId, channel, templateId, variables });

  revalidatePath(`/leads/${leadId}`);
  return message;
}
