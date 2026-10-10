import { createHmac } from "node:crypto";

import { z } from "zod";

import type { LeadInput } from "@/lib/leads/ingest";
import { normalizePhone } from "@/lib/utils/normalize-contact";

const SOURCES = ["app", "web", "referral", "organic"] as const;

/** The app's clock is another system: accept consent timestamps up to this far ahead (and clamp them to now). */
const CONSENT_MAX_AHEAD_MS = 24 * 60 * 60 * 1000;

// Required fields are strict. Optional fields (see `optional*` below) are read leniently: null, empty or malformed
// optionals are dropped so they never cost a signup.
const schema = z.object({
  // The idempotency key: restrict to a boring character set so it is safe in logs, URLs and the ledger.
  userId: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._:@-]+$/, "contains unsupported characters"),
  name: z.string().trim().min(1).max(200),
  mobile: z.string().trim().min(8).max(25),
  // DPDP: no consent timestamp, no lead.
  consentAt: z.string().datetime({ offset: true }),
});

const emailSchema = z.string().trim().toLowerCase().email().max(200);

function optionalText(v: unknown, max: number): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
}

function optionalIso(v: unknown): string | undefined {
  const r = z.string().datetime({ offset: true }).safeParse(v);
  return r.success ? r.data : undefined;
}

/** The validated, typed subset of the request: the only data persisted (unknown fields never are). */
export type AppSignupContract = {
  userId: string;
  name: string;
  mobile: string;
  email?: string;
  city?: string;
  source: (typeof SOURCES)[number];
  referralCode?: string;
  consentAt: string;
  signedUpAt?: string;
  /** Keyed hash of the app's device identifier (HMAC-SHA256, hex). The raw identifier is never stored. Used only for abuse signals. */
  deviceHash?: string;
};

/** A device identifier from the app: visible ASCII with no spaces, 8 to 128 characters. Anything else is dropped. */
const DEVICE_ID = /^[\x21-\x7E]{8,128}$/;

/** Hash the identifier with a server-side key (domain separated), so what we keep cannot be reversed or matched against other systems. No key: no hash. */
function hashDevice(raw: unknown, key: string | undefined): string | undefined {
  if (!key || typeof raw !== "string" || !DEVICE_ID.test(raw)) return undefined;
  return createHmac("sha256", key).update(`device:v1:${raw}`, "utf8").digest("hex");
}

/** Same acceptance rule as ingest's normalizeLeadPhone (not imported: ingest pulls in Prisma/auth at module load). */
function plausiblePhone(raw: string): boolean {
  let digits = normalizePhone(raw);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.length >= 8 && digits.length <= 15;
}


/**
 * Maps the Allvest app's signup payload to a LeadInput (and the minimised `contract` to persist as the raw payload).
 * - unknown fields are ignored and never forwarded;
 * - null / empty / malformed optionals (email, city, source, referralCode, signedUpAt) are dropped, the signup is kept;
 * - consentAt up to 24 h ahead (app clock skew) is accepted and clamped to `now`; further ahead is rejected;
 * - an optional deviceId is hashed with opts.deviceKey and only the hash is kept (dropped when malformed or when there is no key);
 * - mobile must normalise to a plausible number (8-15 digits, a leading 0 on 11 digits is stripped).
 */
export function mapAppSignup(
  payload: unknown,
  now: number = Date.now(),
  opts: { deviceKey?: string } = {},
): { ok: true; lead: LeadInput; contract: AppSignupContract } | { ok: false; reason: string } {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return { ok: false, reason: "payload must be a JSON object" };
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues.map((i) => `${i.path.join(".") || "payload"}: ${i.message}`).join("; ") };
  const d = parsed.data;
  const o = payload as Record<string, unknown>;

  const consentMs = Date.parse(d.consentAt);
  if (consentMs > now + CONSENT_MAX_AHEAD_MS) return { ok: false, reason: "consentAt: too far in the future" };
  if (!plausiblePhone(d.mobile)) return { ok: false, reason: "mobile: not a valid phone number" };

  const rawSource = optionalText(o.source, 20);
  const source = (SOURCES as readonly string[]).includes(rawSource ?? "") ? (rawSource as (typeof SOURCES)[number]) : "organic";
  const email = emailSchema.safeParse(o.email);

  const contract: AppSignupContract = {
    userId: d.userId,
    name: d.name,
    mobile: d.mobile,
    email: email.success ? email.data : undefined,
    city: optionalText(o.city, 100),
    source,
    referralCode: optionalText(o.referralCode, 40),
    // Never store a consent timestamp from the future.
    consentAt: new Date(Math.min(consentMs, now)).toISOString(),
    signedUpAt: optionalIso(o.signedUpAt),
    ...(hashDevice(o.deviceId, opts.deviceKey) ? { deviceHash: hashDevice(o.deviceId, opts.deviceKey) } : {}),
  };

  return {
    ok: true,
    contract,
    lead: {
      source: "allvest_app",
      externalId: contract.userId,
      leadSource: `App Signup (${source})`,
      name: contract.name,
      phone: contract.mobile,
      email: contract.email,
      city: contract.city,
      attribution: Object.fromEntries(
        Object.entries({ signup_source: source, referral_code: contract.referralCode, signed_up_at: contract.signedUpAt }).filter(([, v]) => v),
      ) as Record<string, string>,
      consent: { at: contract.consentAt },
    },
  };
}
