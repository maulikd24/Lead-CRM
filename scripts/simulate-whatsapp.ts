// Simulates the WhatsApp worker against a LOCAL dev CRM — signed events, outbox claim/result — so the
// inbox can be verified end-to-end without a real WhatsApp number.
//
//   npm run simulate:whatsapp -- smoke        # automated assertions (PASS/FAIL)
//   npm run simulate:whatsapp -- setup        # create/refresh demo accounts rm_1 / rm_2 as CONNECTED
//   npm run simulate:whatsapp -- inbound rm_1 9876500001 "Hello" "Asha Rao"
//   npm run simulate:whatsapp -- phone-out rm_1 9876500001 "Sent from the RM's phone"
//   npm run simulate:whatsapp -- claim rm_1 [--fail]
//   npm run simulate:whatsapp -- qr rm_1
//
// Needs: the dev server running, DATABASE_URL + WHATSAPP_WORKER_SECRET in .env. Refuses to run
// against any non-local database (smoke creates clients and never cleans them up).
import "dotenv/config";
import crypto from "node:crypto";

import { prisma } from "../src/lib/db/prisma";
import { signWorkerRequest } from "../src/lib/whatsapp/worker-auth";
import { getInboxScope } from "../src/lib/whatsapp/inbox-scope";
import { getThread, listConversations } from "../src/lib/whatsapp/inbox-queries";
import { queueWhatsAppReply } from "../src/lib/whatsapp/send";

const BASE_URL = process.env.CRM_BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.WHATSAPP_WORKER_SECRET ?? "";

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  const host = (() => {
    try {
      return new URL(url.replace(/^prisma\+postgres/, "postgres")).hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    console.error(`Refusing to run: DATABASE_URL host "${host}" is not local. This script writes test data.`);
    process.exit(1);
  }
  if (!SECRET) {
    console.error("WHATSAPP_WORKER_SECRET is not set in .env");
    process.exit(1);
  }
}

async function signedFetch(method: "GET" | "POST", pathWithQuery: string, body?: unknown, opts: { timestamp?: string; signature?: string } = {}) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const timestamp = opts.timestamp ?? String(Date.now());
  const signature = opts.signature ?? signWorkerRequest(SECRET, timestamp, method, pathWithQuery, raw);
  const response = await fetch(`${BASE_URL}${pathWithQuery}`, {
    method,
    headers: { "content-type": "application/json", "x-worker-timestamp": timestamp, "x-worker-signature": signature },
    body: method === "POST" ? raw : undefined,
  });
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // non-JSON body
  }
  return { status: response.status, json: json as Record<string, unknown> | null };
}

type EventResult = { outcome: string; reason?: string; clientId?: string };

async function sendEvents(events: unknown[]): Promise<EventResult[]> {
  const res = await signedFetch("POST", "/api/internal/whatsapp/events", { events });
  if (res.status !== 200) throw new Error(`events endpoint returned ${res.status}: ${JSON.stringify(res.json)}`);
  return (res.json as { results: EventResult[] }).results;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);
const uid = () => crypto.randomBytes(6).toString("hex");

function messageEvent(o: { sessionId: string; phone: string; body: string; fromMe?: boolean; externalId?: string; pushName?: string; chatId?: string; messageType?: string }) {
  return {
    type: "message",
    sessionId: o.sessionId,
    externalId: o.externalId ?? `SIM_${uid()}`,
    chatId: o.chatId ?? `91${o.phone}@c.us`,
    fromMe: o.fromMe ?? false,
    body: o.body,
    messageType: o.messageType ?? "chat",
    timestamp: nowSeconds(),
    pushName: o.pushName,
  };
}

async function setupAccounts() {
  const [raj, priya] = await Promise.all([
    prisma.user.findUnique({ where: { email: "rm@supportify.local" } }),
    prisma.user.findUnique({ where: { email: "rm2@supportify.local" } }),
  ]);
  if (!raj || !priya) throw new Error("Seeded RMs rm@/rm2@supportify.local not found — run the base seed first");

  const rm1 = await prisma.whatsAppAccount.upsert({
    where: { sessionId: "rm_1" },
    update: { label: "RM 1", ownerUserId: raj.id, isActive: true },
    create: { sessionId: "rm_1", label: "RM 1", ownerUserId: raj.id },
  });
  const rm2 = await prisma.whatsAppAccount.upsert({
    where: { sessionId: "rm_2" },
    update: { label: "RM 2", ownerUserId: priya.id, isActive: true },
    create: { sessionId: "rm_2", label: "RM 2", ownerUserId: priya.id },
  });

  await sendEvents([
    { type: "status", sessionId: "rm_1", status: "CONNECTED", phoneNumber: "919999000001" },
    { type: "status", sessionId: "rm_2", status: "CONNECTED", phoneNumber: "919999000002" },
  ]);
  return { raj, priya, rm1, rm2 };
}

// ---------------------------------------------------------------------------------------------
// smoke
// ---------------------------------------------------------------------------------------------
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `  -> ${JSON.stringify(detail)}`}`);
}

async function smoke() {
  const { raj, priya, rm1 } = await setupAccounts();
  const [admin, manager] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { email: "admin@supportify.local" } }),
    prisma.user.findUniqueOrThrow({ where: { email: "manager@supportify.local" } }),
  ]);
  // Earlier runs (and manual UI testing) can leave replies QUEUED on the demo accounts; the claim checks below
  // expect an otherwise empty outbox, so start from one. Local dev database only.
  await prisma.message.deleteMany({ where: { status: "QUEUED", direction: "OUTBOUND", account: { sessionId: { in: ["rm_1", "rm_2"] } } } });
  const phone = `9${Math.floor(100000000 + Math.random() * 899999999)}`;
  const otherPhone = `9${Math.floor(100000000 + Math.random() * 899999999)}`;

  console.log("\n== auth ==");
  const body = { events: [] };
  const noSig = await fetch(`${BASE_URL}/api/internal/whatsapp/events`, { method: "POST", body: JSON.stringify(body) });
  check("missing signature -> 401", noSig.status === 401, noSig.status);
  const badSig = await signedFetch("POST", "/api/internal/whatsapp/events", body, { signature: "0".repeat(64) });
  check("wrong signature -> 401", badSig.status === 401, badSig.status);
  const stale = String(Date.now() - 10 * 60 * 1000);
  const staleRaw = JSON.stringify(body);
  const staleSig = signWorkerRequest(SECRET, stale, "POST", "/api/internal/whatsapp/events", staleRaw);
  const staleRes = await signedFetch("POST", "/api/internal/whatsapp/events", body, { timestamp: stale, signature: staleSig });
  check("stale (10 min old) timestamp with valid signature -> 401", staleRes.status === 401, staleRes.status);
  const outboxNoSig = await fetch(`${BASE_URL}/api/internal/whatsapp/outbox?sessionIds=rm_1`);
  check("outbox without signature -> 401", outboxNoSig.status === 401, outboxNoSig.status);

  console.log("\n== ingestion ==");
  const first = messageEvent({ sessionId: "rm_1", phone, body: "Hi, I want to open a demat account", pushName: "Smoke Test Lead" });
  const [r1] = await sendEvents([first]);
  check("inbound from unknown number creates a lead", r1.outcome === "created", r1);
  const client = await prisma.client.findFirst({ where: { mobile: { contains: phone.slice(-10) } } });
  check("lead assigned to the RM who owns the number", client?.assignedToId === raj.id, client?.assignedToId);
  check("lead source is WhatsApp", client?.leadSource === "WhatsApp", client?.leadSource);
  check("lead named from WhatsApp profile name", client?.name === "Smoke Test Lead", client?.name);
  const notif = client ? await prisma.notification.count({ where: { userId: raj.id, type: "inbound_message", payload: { path: ["clientId"], equals: client.id } } }) : 0;
  check("assigned RM got an inbound_message notification", notif >= 1, notif);

  const [dup] = await sendEvents([first]);
  check("replayed event is a duplicate (idempotent)", dup.outcome === "duplicate", dup);
  const [again] = await sendEvents([messageEvent({ sessionId: "rm_1", phone, body: "Are you there?" })]);
  check("second message goes to the same lead", again.outcome === "created" && again.clientId === client?.id, again);
  const count = client ? await prisma.message.count({ where: { clientId: client.id, accountId: rm1.id } }) : 0;
  check("thread has exactly 2 messages (no duplicates)", count === 2, count);
  const clientCount = await prisma.client.count({ where: { mobile: { contains: phone.slice(-10) } } });
  check("only one client exists for that number", clientCount === 1, clientCount);

  const ignored = await sendEvents([
    messageEvent({ sessionId: "rm_1", phone, body: "group", chatId: "120363000000@g.us" }),
    messageEvent({ sessionId: "rm_1", phone, body: "status", chatId: "status@broadcast" }),
    messageEvent({ sessionId: "rm_1", phone, body: "masked", chatId: "1234567890123@lid" }),
    messageEvent({ sessionId: "rm_1", phone, body: "sys", messageType: "e2e_notification" }),
    messageEvent({ sessionId: "nope_9", phone, body: "unknown account" }),
  ]);
  check("groups / broadcasts / @lid / system messages / unknown accounts are ignored", ignored.every((r) => r.outcome === "ignored"), ignored);

  const [mirrored] = await sendEvents([messageEvent({ sessionId: "rm_1", phone, body: "Typed on the phone", fromMe: true })]);
  check("outbound typed on the RM's phone is mirrored", mirrored.outcome === "created", mirrored);
  const mirroredRow = client ? await prisma.message.findFirst({ where: { clientId: client.id, body: "Typed on the phone" } }) : null;
  check("mirrored message is OUTBOUND / origin=phone", mirroredRow?.direction === "OUTBOUND" && mirroredRow.origin === "phone", mirroredRow);
  const [toUnknown] = await sendEvents([messageEvent({ sessionId: "rm_1", phone: otherPhone, body: "to a stranger", fromMe: true })]);
  check("outbound to an unknown number is skipped (no lead created)", toUnknown.outcome === "skipped", toUnknown);
  check("...and no client was created for it", (await prisma.client.count({ where: { mobile: { contains: otherPhone.slice(-10) } } })) === 0);

  console.log("\n== send flow (outbox) ==");
  if (!client) throw new Error("client missing");
  const queued = await queueWhatsAppReply({ user: { id: admin.id, role: admin.role }, clientId: client.id, body: "Thanks — sharing the form now" });
  check("reply is queued", queued.status === "QUEUED" && queued.origin === "crm", queued);
  const claim1 = await signedFetch("GET", "/api/internal/whatsapp/outbox?sessionIds=rm_1&limit=10");
  const items1 = (claim1.json as { items: { id: string; chatId: string; body: string }[] }).items;
  check("worker claims the queued message", items1.length === 1 && items1[0].id === queued.id, items1);
  check("claimed message carries the customer's original chatId", items1[0]?.chatId === `91${phone}@c.us`, items1[0]?.chatId);
  const claim2 = await signedFetch("GET", "/api/internal/whatsapp/outbox?sessionIds=rm_1&limit=10");
  check("an immediate second poll does not re-claim it", ((claim2.json as { items: unknown[] }).items).length === 0);
  const extId = `SIM_OUT_${uid()}`;
  const res1 = await signedFetch("POST", `/api/internal/whatsapp/outbox/${queued.id}/result`, { ok: true, externalId: extId });
  const res2 = await signedFetch("POST", `/api/internal/whatsapp/outbox/${queued.id}/result`, { ok: true, externalId: extId });
  check("result callback is idempotent", res1.status === 200 && res2.status === 200, [res1.status, res2.status]);
  const sentRow = await prisma.message.findUnique({ where: { id: queued.id } });
  check("message is SENT with the WhatsApp id", sentRow?.status === "SENT" && sentRow.externalId === extId, sentRow);
  const [echo] = await sendEvents([messageEvent({ sessionId: "rm_1", phone, body: "Thanks — sharing the form now", fromMe: true, externalId: extId })]);
  check("the fromMe echo of a CRM-sent message is a duplicate, not a phone-origin twin", echo.outcome === "duplicate", echo);

  const [ack3] = await sendEvents([{ type: "ack", sessionId: "rm_1", externalId: extId, ack: 3 }]);
  const [ack1] = await sendEvents([{ type: "ack", sessionId: "rm_1", externalId: extId, ack: 1 }]);
  const afterAck = await prisma.message.findUnique({ where: { id: queued.id } });
  check("ack advances SENT -> READ and never downgrades", ack3.outcome === "updated" && ack1.outcome === "updated" && afterAck?.status === "READ", afterAck?.status);

  // Race: the fromMe echo lands BEFORE the result callback.
  const raceQueued = await queueWhatsAppReply({ user: { id: admin.id, role: admin.role }, clientId: client.id, body: "Race message" });
  await signedFetch("GET", "/api/internal/whatsapp/outbox?sessionIds=rm_1&limit=10");
  const raceId = `SIM_RACE_${uid()}`;
  const [adopted] = await sendEvents([messageEvent({ sessionId: "rm_1", phone, body: "Race message", fromMe: true, externalId: raceId })]);
  check("echo arriving before the result callback adopts the in-flight CRM row", adopted.outcome === "adopted", adopted);
  const lateResult = await signedFetch("POST", `/api/internal/whatsapp/outbox/${raceQueued.id}/result`, { ok: true, externalId: raceId });
  check("late result callback succeeds", lateResult.status === 200, lateResult.status);
  const raceRows = await prisma.message.count({ where: { accountId: rm1.id, externalId: raceId } });
  check("exactly one row exists for the raced message", raceRows === 1, raceRows);

  const failQueued = await queueWhatsAppReply({ user: { id: admin.id, role: admin.role }, clientId: client.id, body: "This one fails" });
  await signedFetch("GET", "/api/internal/whatsapp/outbox?sessionIds=rm_1&limit=10");
  await signedFetch("POST", `/api/internal/whatsapp/outbox/${failQueued.id}/result`, { ok: false, error: "Simulated send error" });
  const failedRow = await prisma.message.findUnique({ where: { id: failQueued.id } });
  check("failed send is marked FAILED with the error", failedRow?.status === "FAILED" && (failedRow.metadata as { error?: string } | null)?.error === "Simulated send error", failedRow);

  console.log("\n== RBAC ==");
  const rajScope = getInboxScope({ id: raj.id, role: "RM" });
  const priyaScope = getInboxScope({ id: priya.id, role: "RM" });
  const adminScope = getInboxScope({ id: admin.id, role: "ADMIN" });
  const managerScope = getInboxScope({ id: manager.id, role: "MANAGER" });
  if (!rajScope || !priyaScope || !adminScope || !managerScope) throw new Error("scope missing");
  check("DEALER has no inbox access", getInboxScope({ id: "x", role: "DEALER" }) === null);
  const has = async (scope: typeof rajScope) => (await listConversations(scope)).some((c) => c.clientId === client.id);
  check("RM Raj (assigned) sees the thread", await has(rajScope));
  check("RM Priya (not assigned) does NOT see it", !(await has(priyaScope)));
  check("Admin sees it", await has(adminScope));
  check("Manager sees it (unified inbox)", await has(managerScope));
  check("RM Priya cannot open the thread by id", (await getThread({ id: priya.id, role: "RM" }, priyaScope, client.id)) === null);
  const managerThread = await getThread({ id: manager.id, role: "MANAGER" }, managerScope, client.id);
  check("Manager can open the thread but cannot reply", managerThread !== null && managerThread.canReply === false, managerThread?.replyBlockedReason);
  let managerBlocked = false;
  try {
    await queueWhatsAppReply({ user: { id: manager.id, role: "MANAGER" }, clientId: client.id, body: "nope" });
  } catch {
    managerBlocked = true;
  }
  check("Manager send is rejected server-side", managerBlocked);
  const rajThreadBefore = await getThread({ id: raj.id, role: "RM" }, rajScope, client.id);
  check("assigned RM opening the thread clears unread", (await prisma.message.count({ where: { clientId: client.id, direction: "INBOUND", readAt: null, accountId: { not: null } } })) === 0 && rajThreadBefore !== null);

  console.log("\n== reassignment ==");
  await prisma.client.update({ where: { id: client.id }, data: { assignedToId: priya.id } });
  check("after reassigning Raj -> Priya: Raj loses the thread", !(await has(rajScope)));
  check("...and Priya gains it", await has(priyaScope));
  check("...and Raj can no longer open it by id", (await getThread({ id: raj.id, role: "RM" }, rajScope, client.id)) === null);
  const afterReassign = await queueWhatsAppReply({ user: { id: priya.id, role: "RM" }, clientId: client.id, body: "Hi, I'm your new RM" });
  check("Priya's reply still goes out from the ORIGINAL number (rm_1)", afterReassign.accountId === rm1.id, afterReassign.accountId);
  let rajBlocked = false;
  try {
    await queueWhatsAppReply({ user: { id: raj.id, role: "RM" }, clientId: client.id, body: "still me?" });
  } catch {
    rajBlocked = true;
  }
  check("Raj can no longer send to it", rajBlocked);
  await prisma.client.update({ where: { id: client.id }, data: { assignedToId: raj.id } });

  console.log("\n== QR / status ==");
  const pngBase64 = Buffer.from("fake-png-bytes-for-testing-purposes-only-1234567890").toString("base64");
  const [qrOk] = await sendEvents([{ type: "qr", sessionId: "rm_2", qr: `data:image/png;base64,${pngBase64}` }]);
  const rm2Row = await prisma.whatsAppAccount.findUniqueOrThrow({ where: { sessionId: "rm_2" } });
  check("valid QR is stored and account goes QR_PENDING", qrOk.outcome === "updated" && rm2Row.status === "QR_PENDING" && !!rm2Row.qrDataUrl, rm2Row.status);
  const [qrBad] = await sendEvents([{ type: "qr", sessionId: "rm_2", qr: "javascript:alert(document.cookie)//aaaaaaaaaaaaaaaaaaaa" }]);
  check("non-image QR payloads are rejected", qrBad.outcome === "ignored", qrBad);
  await sendEvents([{ type: "status", sessionId: "rm_2", status: "CONNECTED", phoneNumber: "919999000002" }]);
  const rm2After = await prisma.whatsAppAccount.findUniqueOrThrow({ where: { sessionId: "rm_2" } });
  check("CONNECTED clears the QR", rm2After.status === "CONNECTED" && rm2After.qrDataUrl === null);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

async function main() {
  assertLocalDatabase();
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "smoke":
      await smoke();
      break;
    case "setup": {
      await setupAccounts();
      console.log("Demo accounts rm_1 (RM Raj) and rm_2 (RM Priya) are CONNECTED.");
      break;
    }
    case "inbound": {
      const [sessionId, phone, text, pushName] = args;
      console.log(await sendEvents([messageEvent({ sessionId, phone, body: text, pushName })]));
      break;
    }
    case "phone-out": {
      const [sessionId, phone, text] = args;
      console.log(await sendEvents([messageEvent({ sessionId, phone, body: text, fromMe: true })]));
      break;
    }
    case "claim": {
      const [sessionId] = args;
      const res = await signedFetch("GET", `/api/internal/whatsapp/outbox?sessionIds=${sessionId}&limit=10`);
      const items = (res.json as { items: { id: string; chatId: string; body: string }[] }).items;
      for (const item of items) {
        const fail = args.includes("--fail");
        const result = await signedFetch(
          "POST",
          `/api/internal/whatsapp/outbox/${item.id}/result`,
          fail ? { ok: false, error: "Simulated failure" } : { ok: true, externalId: `SIM_OUT_${uid()}` },
        );
        console.log(`${fail ? "failed" : "sent"} -> ${item.chatId}: "${item.body}" (${result.status})`);
      }
      if (items.length === 0) console.log("Nothing queued.");
      break;
    }
    case "qr": {
      // Optional 2nd arg: path to a file containing a base64-encoded PNG, so the UI renders a real image.
      const [sessionId, pngBase64File] = args;
      const png = pngBase64File
        ? (await import("node:fs")).readFileSync(pngBase64File, "utf8").trim()
        : Buffer.from(`sim-qr-${uid()}-padding-padding-padding`).toString("base64");
      console.log(await sendEvents([{ type: "qr", sessionId, qr: `data:image/png;base64,${png}` }]));
      break;
    }
    default:
      console.log("Commands: smoke | setup | inbound <session> <10-digit> <text> [name] | phone-out <session> <10-digit> <text> | claim <session> [--fail] | qr <session>");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
