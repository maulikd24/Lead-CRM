import { notFound } from "next/navigation";

import { requireMarketing } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { loadAudienceOptions, type StudioTemplate } from "@/lib/marketing/broadcast/audience";
import { marketingPageEnabled } from "@/lib/marketing/flags";
import { variablesOf } from "@/lib/messaging/template-vars";

import { StudioWizard } from "./studio-wizard";

export const metadata = { title: "New broadcast" };
export const dynamic = "force-dynamic";

export default async function NewBroadcastPage() {
  const session = await requireMarketing("marketing", "manage");
  if (!marketingPageEnabled()) notFound();

  const [options, rows] = await Promise.all([
    loadAudienceOptions(),
    prisma.messageTemplate.findMany({ where: { approved: true, channel: { in: ["whatsapp", "sms"] } }, select: { id: true, name: true, channel: true, body: true }, orderBy: { name: "asc" } }),
  ]);
  const templates: StudioTemplate[] = rows.map((t) => ({ id: t.id, name: t.name, channel: t.channel as StudioTemplate["channel"], body: t.body, variables: variablesOf(t.body) }));

  return <StudioWizard options={options} templates={templates} userId={session.user.id} canManageTemplates={session.user.role === "ADMIN"} />;
}
