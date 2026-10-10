import type { Loaded } from "./load";
import type { Tone } from "./view-models";

export type DataStatus = { key: "sample" | "verified" | "unverified" | "not_connected" | "error"; label: string; tone: Tone; hint: string };

/** One plain status for the connection behind the numbers on screen: what they are, and how far to trust them. Pure. */
export function dataStatus(loaded: Loaded<unknown>): DataStatus {
  if (loaded.status === "not_connected") return { key: "not_connected", label: "Not connected", tone: "warning", hint: "No numbers are shown until an administrator connects the referral API." };
  if (loaded.status === "error") return { key: "error", label: "Service error", tone: "destructive", hint: "The referral service did not answer properly. Nothing is guessed." };
  if (loaded.sample) return { key: "sample", label: "Sample data", tone: "warning", hint: "Every name and number is made up. None of it comes from the programme." };
  if (!loaded.contractVerified) return { key: "unverified", label: "Contract not verified", tone: "warning", hint: "Live, but field names are unconfirmed. Check figures against the source." };
  return { key: "verified", label: "Contract verified", tone: "success", hint: "Live, and the field names were checked against the service." };
}

export type ContractInfo = { state: "mock" | "not_connected" | "live"; verified: boolean; verifiedAt: string | null; version: string };

/** What the Contract check tab says, in order: where you are, what is wrong (if anything), what to do next. Pure. */
export function buildContractVM(info: ContractInfo, opts: { isAdmin: boolean }) {
  const status: DataStatus =
    info.state === "not_connected"
      ? { key: "not_connected", label: "Not connected", tone: "warning", hint: "There is nothing to check until the referral API is connected." }
      : info.state === "mock"
        ? { key: "sample", label: "Sample data", tone: "warning", hint: "Sample data has no contract to check. Connect the live API first." }
        : info.verified
          ? { key: "verified", label: "Contract verified", tone: "success", hint: "An administrator ran the check and accepted the result." }
          : { key: "unverified", label: "Contract not verified", tone: "warning", hint: "Live, but nobody has recorded a passing check for this version yet." };
  const verifiedOn = info.verified && info.verifiedAt && !Number.isNaN(new Date(info.verifiedAt).getTime()) ? new Date(info.verifiedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : null;
  const steps: string[] =
    info.state !== "live"
      ? ["Connect the referral API in Settings, Apps and Integrations, in live mode."]
      : info.verified
        ? ["Nothing to do. Saving new connection details, or a new contract version, clears the mark and asks for a fresh check."]
        : [
            "Run the contract check against the service (see the command below).",
            "Read its result: missing fields fail, extra fields and unknown statuses are only noted.",
            opts.isAdmin ? "Record it with Mark contract verified in Settings, Apps and Integrations." : "Ask an administrator to record it in Settings, Apps and Integrations.",
          ];
  return { status, version: info.version, verifiedOn, steps, canOpenSettings: opts.isAdmin };
}

/** What the check covers, so a reader knows what "verified" stands for. Mirrors docs/partner-workspace.md. */
export const CONTRACT_CHECKS: { title: string; detail: string }[] = [
  { title: "Required fields", detail: "Every field the pages depend on is present. A missing one fails the check; it is never shown as zero." },
  { title: "Extra and unknown values", detail: "Unknown extra keys and unrecognised status values are reported as counts only, never as values." },
  { title: "Nothing sensitive", detail: "No PAN-like or bank-like keys anywhere in the responses. Their presence fails the check." },
  { title: "Numbers agree", detail: "Summary totals match the list totals, payout totals match the per-status totals, earnings match the sum of affiliates." },
  { title: "Paging and access", detail: "Pages echo their window, the last page and an offset past the end behave, and a request without a token is refused." },
];

export const CONTRACT_COMMAND = "PARTNER_API_BASE=https://host/base PARTNER_API_TOKEN=<view-only token> npx tsx scripts/partner-contract-check.ts";
