/**
 * Test kit (not shipped, not a test): seeds one synthetic customer with at least one row in EVERY relationship-registry table that an erasure deletes
 * (and optionally one row of a table that blocks it), so the registry-driven erasure and merge can be compared with the original code on a real database.
 * Synthetic values only. Used by the db tests and by the seed script outside the repo.
 */
import type { basePrisma } from "@/lib/db/prisma";

type Db = typeof basePrisma;

export type RichCustomer = { clientId: string; clientCode: string; name: string; phone: string; email: string; probes: string[]; adminId: string; stageId: string };

export async function ensureStageAndAdmin(db: Db, adminKey: string) {
  const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "Registry test stage", sequence: 9201, slaHours: 24 } }));
  const admin = await db.user.upsert({ where: { email: `${adminKey}@example.test` }, update: {}, create: { name: "Registry Admin", email: `${adminKey}@example.test`, passwordHash: "x", role: "ADMIN" } });
  return { stageId: stage.id, adminId: admin.id };
}

/** `tag` makes every unique key and probe string distinct, so two customers can live in one database. */
export async function seedRichCustomer(db: Db, tag: string, o: { stageId: string; adminId: string; mergedInto?: string }): Promise<RichCustomer> {
  const name = `Zqprobe${tag} Surname${tag}`;
  const phone = `98${String(Math.abs([...tag].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % 100000000).padStart(8, "0")}`;
  const email = `zqprobe.${tag.toLowerCase()}@example.test`;
  const client = await db.client.create({ data: { clientCode: `RG-${tag}`, name, mobile: phone, email, pan: `Q${tag.slice(0, 4).toUpperCase().padEnd(4, "X")}1234K`, currentStageId: o.stageId, notes: `Call ${name}`, mergedIntoId: o.mergedInto ?? null } });
  const clientId = client.id;
  const { stageId, adminId } = o;

  const activity = await db.activity.create({ data: { clientId, type: "CALL", payload: { message: `Spoke to ${name}` }, userId: adminId } });
  await db.activity.create({ data: { clientId, type: "NOTE", payload: { message: `Note about ${name}` } } });
  const token = await db.deviceToken.create({ data: { userId: adminId, tokenHash: `rgth-${tag}`, label: `dev-${tag}` } });
  await db.deviceCall.create({ data: { userId: adminId, clientId, deviceTokenId: token.id, activityId: activity.id, phoneKey: phone.slice(-10), direction: "INCOMING", startedAt: new Date(), durationSeconds: 61 } });
  await db.message.create({ data: { clientId, channel: "WHATSAPP", provider: "x", direction: "INBOUND", body: `hi, ${name}`, metadata: { phone } } });
  await db.task.create({ data: { clientId, assignedToId: adminId, title: `Call ${name}`, dueAt: new Date(Date.now() + 86_400_000) } });
  await db.supportTicket.create({ data: { clientId, provider: "freshdesk", externalId: `tk-${tag}`, subject: `Ticket from ${name}` } });
  await db.stageHistory.create({ data: { clientId, toStageId: stageId, changedById: adminId } });
  await db.exception.create({ data: { clientId, stageId, reason: `Exception ${name}` } });
  await db.document.create({ data: { clientId, documentType: "PAN" } });
  await db.accountHolder.create({ data: { clientId, name } });
  await db.conversationReview.create({ data: { clientId, sourceType: "WHATSAPP_THREAD", transcript: `${name}: email ${email}`, aiRawResponse: { quote: name } } });
  await db.conversationInsight.create({ data: { clientId, kind: "INTEREST", text: `${name} wants a call on ${phone}`, sourceType: "NOTE", sourceRef: `n-${tag}`, dedupeKey: `dk-${tag}`, occurredAt: new Date() } });
  await db.interactionOutcome.create({ data: { clientId, outcome: "INTERESTED", channel: "CALL", actorType: "RM", note: `${name} said yes`, summary: name } });
  await db.agentProposal.create({ data: { agentKey: "nudger", clientId, body: `Hello ${name}`, originalBody: `Hello ${name}`, reason: "test", provider: "x", model: "y", expiresAt: new Date(Date.now() + 86_400_000) } });
  const journey = await db.journey.create({ data: { name: `RGJ ${tag}`, definition: { nodes: [] }, createdById: adminId } });
  const run = await db.journeyRun.create({ data: { journeyId: journey.id, clientId } });
  await db.journeyRunStep.create({ data: { runId: run.id, nodeId: "n1", nodeType: "action", status: "DONE" } });
  await db.consentRecord.create({ data: { clientId, purpose: "SERVICE_COMMS", channel: "WHATSAPP", status: "GRANTED", source: "test", noticeVersion: "v1" } });
  await db.customerGoal.create({ data: { clientId, name: `${name} retirement`, targetAmount: 5_000_000, targetDate: new Date("2040-01-01"), notes: `Call ${phone}`, linkedAccountIds: [], linkedHoldingKeys: [] } });
  await db.customerReview.create({ data: { clientId, note: `Reviewed with ${name}` } });
  await db.suggestionDismissal.create({ data: { clientId, ruleKey: "idle_cash", fingerprint: tag, reason: `${name} said wait`, snoozeUntil: new Date("2030-01-01") } });
  await db.outcomeEvent.create({ data: { clientId, name: "goal_created", props: { note: name } } });
  await db.leadPush.create({ data: { clientId, intakeKey: `rg:${tag}`, assignedToId: adminId, context: { answers: { note: `${name} wants a callback` } }, slaMinutes: 15, dueAt: new Date(Date.now() + 900_000) } });
  await db.cleverTapSync.create({ data: { clientId, lastHash: "h", lastError: `failed for ${email}` } });
  // Wave 2: customer memory, a formal complaint (with a history row), a promise, a household consent (about this customer as the subject, for every member) and a shadow decision with
  // feedback, an outcome and a disagreement row. Each quotes the person, so the "no probe left anywhere" check covers them.
  await db.customerMemoryItem.create({ data: { clientId, class: "FACT", key: `fact:note:${tag}`, value: { text: `${name} holds funds elsewhere, call ${phone}` }, sourceType: "rm_entry", sourceRef: `user:${adminId}`, evidence: [{ sourceRef: `user:${adminId}`, summary: `Told us by ${name}`, observedAt: new Date().toISOString() }], confidence: "HIGH", observedAt: new Date(), createdByType: "RM", createdById: adminId } });
  const complaint = await db.complaint.create({ data: { clientId, title: `${name} complaint`, summary: `${name} on ${phone}`, severity: "HIGH", sourceType: "MANUAL", openedAt: new Date(), slaDueAt: new Date(Date.now() + 86_400_000) } });
  await db.complaintEvent.create({ data: { complaintId: complaint.id, type: "opened", note: `Opened for ${name}` } });
  await db.commitment.create({ data: { clientId, promisedByType: "RM", text: `Send ${name} the statement at ${email}`, dueAt: new Date(), sourceType: "MANUAL" } });
  const consentHousehold = await db.household.create({ data: { householdCode: `RGHH-${tag}C`, name: `Consent household ${tag}` } });
  await db.householdRelationshipConsent.create({ data: { householdId: consentHousehold.id, subjectClientId: clientId, granteeClientId: null, scopes: ["member_identity"], status: "GRANTED", source: "test" } });
  const decision = await db.decisionRecord.create({ data: { clientId, engineVersion: "test", correlationId: `corr_${tag}`, result: "RECOMMEND", action: "Call", programme: "PMS / AIF opportunity", topic: "PMS", reason: `Call ${name} about PMS`, priority: "Medium", priorityScore: 50, owner: "RM", channel: "call", timing: "This Week", confidence: "medium", evidence: [{ text: `${name} asked on ${phone}` }], scoreInputs: [], suppression: [], policyResult: {}, alternatives: [], inputHash: `h-${tag}`, observedAt: new Date() } });
  await db.decisionFeedback.create({ data: { decisionId: decision.id, userId: adminId, kind: "wrong", reason: "wrong_fact" } });
  await db.decisionOutcome.create({ data: { decisionId: decision.id, kind: "contact", eventRef: `a-${tag}`, occurredAt: new Date(), daysAfter: 1, detail: name } });
  await db.decisionDisagreement.create({ data: { decisionId: decision.id, kind: "programme_differs", severity: "minor", summary: `Differs for ${name}` } });
  await db.segmentMembership.create({ data: { clientId, segment: `seg-${tag}` } });
  await db.assetClassAcceptance.create({ data: { clientId, assetClass: "PMS", level: "HIGH", source: "insight", reason: `${name} asked` } });
  await db.customerIntelligence.create({ data: { clientId, lifecycleStage: "Lead", nbaProgramme: "p", nbaAction: "Call", nbaReason: `${name} asked`, nbaPriority: "High", nbaOwner: "RM", nbaTiming: "Today", talkingPoints: [`ask ${name}`], situations: [], doNotDiscuss: [] } });
  await db.smartAllvestProfile.create({ data: { clientId, goals: [{ goal: `${name} retirement` }] } });
  await db.wealthHealthCheckup.create({ data: { clientId, keyFindings: `${name} holds too much cash` } });
  const opp = await db.opportunity.create({ data: { clientId, product: "PMS", estimatedValue: 1000, ownerId: adminId } });
  await db.opportunityStageHistory.create({ data: { opportunityId: opp.id, toStage: "IDENTIFIED", changedById: adminId } });
  await db.kycRecord.create({ data: { clientId, status: "PENDING" } });
  await db.kycStep.create({ data: { clientId, holderKey: "primary", type: "PAN_VERIFICATION" } });
  await db.fundingRecord.create({ data: { clientId, status: "PENDING" } });
  await db.dealerIntroduction.create({ data: { clientId } });
  await db.pmsAifHolding.create({ data: { clientId, productName: `Placeholder ${tag}`, status: "NOT_INVESTED" } });
  const partnerUser = await db.user.upsert({ where: { email: `rg-partner-${tag.toLowerCase()}@example.test` }, update: {}, create: { name: "Registry Partner", email: `rg-partner-${tag.toLowerCase()}@example.test`, passwordHash: "x", role: "PARTNER" } });
  const partner = await db.partnerProfile.upsert({ where: { userId: partnerUser.id }, update: {}, create: { userId: partnerUser.id, partnerCode: `RG-${tag}`, partnerType: "PARTNER" } });
  await db.partnerReferralTouch.create({ data: { clientId, partnerProfileId: partner.id, code: `RG-${tag}`, source: "web", touchedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) } });
  await db.partnerAttributionEvent.create({ data: { clientId, partnerProfileId: partner.id, code: `RG-${tag}`, decision: "recorded", source: "web" } });
  const referrer = await db.referrer.create({ data: { clientId, createdById: adminId, codes: { create: { code: `RGC${tag}` } } } });
  const other = await db.client.create({ data: { clientCode: `RG-${tag}-R`, name: `Referred ${tag}`, currentStageId: stageId } });
  await db.referral.create({ data: { idempotencyKey: `rg-claim-${tag}`, referrerId: referrer.id, referredClientId: other.id, outcome: "ATTRIBUTED", events: { create: [{ type: "SIGNED_UP", occurredAt: new Date() }] } } });
  await db.mergeSuggestion.create({ data: { clientAId: clientId, clientBId: other.id, score: 0.9, reasons: [`same phone ${phone}`] } });
  await db.referralDevice.create({ data: { clientId, deviceHash: `dh-${tag}`.padEnd(64, "0") } });
  await db.leadIntake.create({ data: { source: "web", externalId: `lead-${tag}`, status: "CREATED", clientId, rawPayload: { raw: { name, phone, email } } } });
  await db.notification.create({ data: { userId: adminId, type: "lead_reenquiry", payload: { clientId, clientName: name } } });

  // The new event tables: facts about the customer (with personal-looking metadata, as a future event might carry), a failure record, a dead letter and a work item.
  const ev = await db.customerEvent.create({ data: { eventId: `00000000-0000-4000-8000-${String(Math.abs([...tag].reduce((a, c) => a * 17 + c.charCodeAt(0), 3))).padStart(12, "0").slice(0, 12)}`, eventType: "lead.created", occurredAt: new Date(), actorType: "customer", actorId: phone, clientId, source: "crm.web", correlationId: "corr", schemaVersion: 1, dataClass: "PERSONAL", dedupeKey: `crm.web:${phone}:lead.created`, metadata: { leadSource: "web", note: name }, consentContext: { purpose: "SERVICE_COMMS", status: "GRANTED" } } });
  await db.eventDeadLetter.create({ data: { eventId: ev.id, consumer: "audit", attempts: 5, status: "DEAD", errorClass: "Error" } });
  await db.eventEmitFailure.create({ data: { eventType: "lead.created", source: "crm.web", dedupeKey: `k-${tag}`, clientId, reason: "DB_ERROR", envelope: { type: "lead.created", metadata: { note: name } } } });
  await db.dataHealthItem.create({ data: { checkKey: "no_identity_keys", subjectType: "client", subjectId: clientId, clientId, severity: "WARN", title: "t" } });

  return { clientId, clientCode: client.clientCode, name, phone, email, probes: [name, `Zqprobe${tag}`, phone, email, `Q${tag.slice(0, 4).toUpperCase().padEnd(4, "X")}1234K`], adminId, stageId };
}

/** Every table of the database as `table: row count`, for before/after comparisons. */
export async function tableCounts(db: Db): Promise<Record<string, number>> {
  const tables = await db.$queryRawUnsafe<{ table_name: string }[]>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name NOT LIKE '\\_prisma%'`);
  const out: Record<string, number> = {};
  for (const { table_name } of tables) out[table_name] = Number((await db.$queryRawUnsafe<{ c: bigint }[]>(`SELECT count(*) AS c FROM "${table_name}"`))[0].c);
  return out;
}

export const deltas = (before: Record<string, number>, after: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.keys(after).map((t) => [t, after[t] - (before[t] ?? 0)]).filter(([, d]) => d !== 0));

/** Every table as text, to search for a probe string. */
export async function dumpAllTables(db: Db): Promise<string> {
  const tables = await db.$queryRawUnsafe<{ table_name: string }[]>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name NOT LIKE '\\_prisma%'`);
  const parts: string[] = [];
  for (const { table_name } of tables) {
    const rows = await db.$queryRawUnsafe<{ j: string }[]>(`SELECT row_to_json(t)::text AS j FROM "${table_name}" t`);
    for (const r of rows) parts.push(`${table_name} ${r.j}`);
  }
  return parts.join("\n");
}

/** Removes everything `seedRichCustomer` and the blocker seeds created (customers coded `RG-...`), in dependency order. Touches nothing else: safe on a seeded database. */
export async function cleanupRichCustomers(db: Db): Promise<void> {
  const { registryDeleteChildren } = await import("@/lib/relationships/erase");
  const ids = (await db.client.findMany({ where: { clientCode: { startsWith: "RG-" } }, select: { id: true } })).map((c) => c.id);
  if (ids.length) {
    await db.tradingAccount.deleteMany({ where: { clientId: { in: ids } } });
    await db.householdMember.deleteMany({ where: { clientId: { in: ids } } });
    await db.revenueEvent.deleteMany({ where: { clientId: { in: ids } } });
    await db.clientPayment.deleteMany({ where: { clientId: { in: ids } } });
    await db.advisoryInteraction.deleteMany({ where: { clientId: { in: ids } } });
    await db.pmsAifHolding.deleteMany({ where: { clientId: { in: ids } } });
    await db.$transaction(async (tx) => {
      await registryDeleteChildren(tx as never, ids);
      await tx.leadIntake.deleteMany({ where: { OR: [{ clientId: { in: ids } }, { externalId: { startsWith: "lead-" } }] } });
      for (const id of ids) await tx.notification.deleteMany({ where: { payload: { path: ["clientId"], equals: id } } });
      await tx.client.deleteMany({ where: { id: { in: ids } } });
    });
  }
  await db.household.deleteMany({ where: { householdCode: { startsWith: "RGHH-" } } });
  await db.journey.deleteMany({ where: { name: { startsWith: "RGJ " } } });
  await db.deviceToken.deleteMany({ where: { tokenHash: { startsWith: "rgth-" } } });
  await db.partnerProfile.deleteMany({ where: { partnerCode: { startsWith: "RG-" } } });
  await db.user.deleteMany({ where: { email: { startsWith: "rg-partner-" } } });
  // Events the suites created: about these customers, the erased ones (their dedupe key is hashed), and the timeline suite's own facts.
  const erased = await db.customerEvent.findMany({ where: { OR: [{ clientId: { in: ids } }, { dedupeKey: { startsWith: "erased:" } }, { dedupeKey: { startsWith: "tl-" } }] }, select: { id: true } });
  await db.eventDeadLetter.deleteMany({ where: { eventId: { in: erased.map((e) => e.id) } } });
  await db.customerEvent.deleteMany({ where: { id: { in: erased.map((e) => e.id) } } });
  await db.eventEmitFailure.deleteMany({ where: { OR: [{ clientId: { in: ids } }, { dedupeKey: { startsWith: "k-" } }] } });
  await db.dataHealthItem.deleteMany({ where: { OR: [{ clientId: { in: ids } }, { subjectId: { in: ids } }] } });
}
