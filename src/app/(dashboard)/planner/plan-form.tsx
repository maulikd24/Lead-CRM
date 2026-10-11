import { ActionForm, type FormField } from "@/components/planner/action-form";
import { CHANNELS, CHANNEL_KEYS } from "@/lib/planner/channels";
import { campaignChoices, listAudiences, listCreators, listDestinations, listPeople, listPromises } from "@/lib/planner/db";
import { isRegisteredCreator, FOLLOW_UP_PURPOSES } from "@/lib/planner/workflow";

import { createPlanAction, updatePlanAction } from "./actions";

const PURPOSE_LABEL: Record<string, string> = { MARKETING_COMMS: "Marketing messages (WhatsApp, email, SMS)", SERVICE_COMMS: "Service messages" };

/** One form for a new plan and for editing one. The server re-validates everything (archived, unregistered creator, past dates). */
export async function PlanForm({ planId, initial, preset }: { planId?: string; initial?: Record<string, unknown>; preset?: { audienceId?: string; channel?: string } }) {
  const [audiences, promises, destinations, creators, people, campaigns] = await Promise.all([listAudiences(), listPromises(), listDestinations(), listCreators(), listPeople("plan-owner"), campaignChoices()]);
  const fields: FormField[] = [
    { name: "title", label: "Title", required: true, maxLength: 120, help: "What this run is, in a few words." },
    { name: "audienceId", label: "Audience", type: "select", required: true, options: [{ value: "", label: "Choose" }, ...audiences.filter((a) => !a.archivedAt).map((a) => ({ value: a.id, label: a.name }))] },
    { name: "promiseId", label: "Promise", type: "select", required: true, options: [{ value: "", label: "Choose" }, ...promises.filter((p) => !p.archivedAt).map((p) => ({ value: p.id, label: p.hook }))] },
    { name: "channel", label: "Channel", type: "select", required: true, options: [{ value: "", label: "Choose" }, ...CHANNEL_KEYS.map((k) => ({ value: k, label: CHANNELS[k].label }))] },
    { name: "destinationId", label: "Destination", type: "select", required: true, options: [{ value: "", label: "Choose" }, ...destinations.map((d) => ({ value: d.id, label: `${d.name}${d.status === "LIVE" ? "" : " (not live yet)"}` }))], help: "A destination that is not live yet can be attached but the plan cannot be approved until it is live." },
    { name: "creatorId", label: "Creator (short video only)", type: "select", options: [{ value: "", label: "None" }, ...creators.map((c) => ({ value: c.id, label: `${c.name}${isRegisteredCreator(c) ? "" : " (blocked: no SEBI registration)"}` }))], help: "Only creators with a valid SEBI registration number can be attached." },
    { name: "budgetInr", label: "Budget (INR)", type: "number" },
    { name: "startDate", label: "Start date", type: "date" },
    { name: "endDate", label: "End date", type: "date" },
    { name: "ownerId", label: "Owner", type: "select", required: true, options: [{ value: "", label: "Choose" }, ...people.map((p) => ({ value: p.id, label: p.name }))] },
    { name: "consentPurpose", label: "Consent the follow-up relies on", type: "select", options: [{ value: "", label: "Choose" }, ...FOLLOW_UP_PURPOSES.map((p) => ({ value: p, label: PURPOSE_LABEL[p] ?? p }))], help: "Needed before approval: follow-up messages only go to people who agreed." },
    { name: "outcomeKey", label: "Linked ad campaign (for results)", type: "select", options: [{ value: "", label: "Not linked: results are not measured" }, ...campaigns.map((c) => ({ value: c.key, label: c.label }))], help: "Results (leads, KYC, funded) come from the synced campaign you link here." },
    { name: "notes", label: "Notes", type: "textarea" },
  ];
  const base: Record<string, unknown> = { ...(preset?.audienceId ? { audienceId: preset.audienceId } : {}), ...(preset?.channel ? { channel: preset.channel } : {}), ...initial };
  return planId ? (
    <ActionForm label="Edit plan" fields={fields} initial={base} action={(v) => updatePlanAction(planId, v)} submitLabel="Save plan" />
  ) : (
    <ActionForm label="New plan" fields={fields} initial={base} action={createPlanAction} submitLabel="Create plan" redirectTo={(r) => `/planner/${r.id}`} />
  );
}
