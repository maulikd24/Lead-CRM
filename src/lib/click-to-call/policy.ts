import { phoneKey } from "@/lib/clients/identity-keys";

/**
 * When client calls may be placed: 09:00–21:00 India time, every day — the window TRAI sets for commercial calls. Always judged
 * in IST, whatever time zone the server runs in.
 */
export const CALLING_HOURS = { startHour: 9, endHour: 21 } as const;

export function istHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(now));
}

export function withinCallingHours(now: Date): boolean {
  const h = istHour(now);
  return h >= CALLING_HOURS.startHour && h < CALLING_HOURS.endHour;
}

/** A number Exotel can dial: Indian numbers as 0 + 10 digits; anything else (international) as + and its digits. */
export function exotelNumber(raw: string | null | undefined): string | null {
  const key = phoneKey(raw);
  if (!key) return null;
  return key.length === 10 ? `0${key}` : `+${key}`;
}

/** A valid calling number for a user: an Indian mobile (10 digits starting 6–9) in any common format. */
export function isValidCallPhone(raw: string): boolean {
  const key = phoneKey(raw);
  return !!key && /^[6-9]\d{9}$/.test(key);
}

export type CallCheck = {
  now: Date;
  clientStatus: string;
  clientMobile: string | null;
  callerPhone: string | null;
  /** The consent ledger's answer for SERVICE_COMMS on the call channel (always allowed while enforcement is off). */
  consentAllowed: boolean;
  hasActiveCall: boolean;
};

/** Why a click-to-call can't be placed right now, in words for the button's tooltip — or null when it can. */
export function callBlockReason(c: CallCheck): string | null {
  if (c.hasActiveCall) return "You're already on a call from Supportify.";
  if (!c.callerPhone) return "Add your calling number in Settings → Account first.";
  if (!exotelNumber(c.clientMobile)) return "This client has no valid mobile number.";
  if (c.clientStatus === "NOT_PROCEEDING") return "This client is marked Not proceeding.";
  if (!c.consentAllowed) return "This client has opted out of calls.";
  if (!withinCallingHours(c.now)) return `Calls can be placed between ${CALLING_HOURS.startHour}:00 and ${CALLING_HOURS.endHour}:00 IST.`;
  return null;
}

export const ACTIVE_CALL_STATUSES = ["QUEUED", "IN_PROGRESS"] as const;
/** A call still "active" after this long is treated as over (a lost callback must not block the next call forever). */
export const STALE_CALL_MINUTES = 90;

/** Exotel's call status → ours. Unknown terminal values count as FAILED. */
export function callStatusFromExotel(status: string | undefined, eventType?: string): "IN_PROGRESS" | "COMPLETED" | "NO_ANSWER" | "BUSY" | "FAILED" {
  const s = (status ?? "").toLowerCase();
  if (eventType === "answered" || s === "in-progress") return "IN_PROGRESS";
  if (s === "completed") return "COMPLETED";
  if (s === "no-answer") return "NO_ANSWER";
  if (s === "busy") return "BUSY";
  return "FAILED";
}
