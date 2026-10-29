import { z } from "zod";

import type { ClientFilterParams } from "@/lib/clients/build-client-where";

/**
 * A Campaign Studio broadcast draft. It is stored as the payload of a BROADCAST_DRAFT approval request, so there is no table of its
 * own: the audience is a filter (not a frozen list of ids), and the send path, when it is wired, must re-run it and the consent filter.
 */
export const BROADCAST_CHANNELS = ["whatsapp", "sms"] as const;
export type BroadcastChannel = (typeof BROADCAST_CHANNELS)[number];
export const CHANNEL_LABEL: Record<BroadcastChannel, string> = { whatsapp: "WhatsApp", sms: "SMS" };

/** A variable whose value is this token is filled per customer at send time. */
export const FIRST_NAME_TOKEN = "@first_name";

export const LIFECYCLE_STATUSES = [
  { value: "", label: "Everyone" },
  { value: "ACTIVE", label: "Onboarding" },
  { value: "COMPLETED", label: "Customers" },
] as const;

const key = z.string().trim().max(80);

export const audienceSchema = z.object({
  status: z.enum(["", "ACTIVE", "COMPLETED"]).default(""),
  stage: key.default(""),
  segment: key.default(""),
  leadSource: key.default(""),
});
export type BroadcastAudience = z.infer<typeof audienceSchema>;
export const EMPTY_AUDIENCE: BroadcastAudience = { status: "", stage: "", segment: "", leadSource: "" };

export const draftSchema = z.object({
  name: z.string().trim().min(3, "Give the broadcast a name of at least 3 characters.").max(80),
  audience: audienceSchema,
  channel: z.enum(BROADCAST_CHANNELS),
  templateId: z.string().trim().min(1, "Pick a template.").max(64),
  variables: z.record(z.string().max(40), z.string().trim().min(1).max(200)),
  scheduledFor: z.string().trim().max(40).default(""),
  note: z.string().trim().max(500).default(""),
});
export type BroadcastDraft = z.infer<typeof draftSchema>;

export const EMPTY_DRAFT: BroadcastDraft = { name: "", audience: EMPTY_AUDIENCE, channel: "whatsapp", templateId: "", variables: {}, scheduledFor: "", note: "" };

/** The audience as /clients filters: never archived, the same rules as the list and its export. */
export function audienceFilter(a: BroadcastAudience): ClientFilterParams {
  return {
    ...(a.status ? { status: a.status } : {}),
    ...(a.stage ? { stage: a.stage } : {}),
    ...(a.segment ? { segment: a.segment } : {}),
    ...(a.leadSource ? { leadSource: a.leadSource } : {}),
  };
}

/** A schedule is optional; when given it must be a real time in the future. */
export function scheduleIssue(value: string, now: Date): string | null {
  if (!value) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "That send time is not a valid date.";
  if (at.getTime() <= now.getTime()) return "Pick a send time in the future.";
  return null;
}
