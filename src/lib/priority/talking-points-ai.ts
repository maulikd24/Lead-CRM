import { callModel, isAnthropicConfigured, isOpenAiConfigured, type GatewayDeps } from "@/lib/ai/gateway";

/**
 * Optional AI rewrite of a customer's talking points, through the gateway under the "rm.talking_points" purpose.
 * Runs only when a provider key is present. Any failure, refusal, abstention or unexpected reply returns null, and the
 * caller keeps the deterministic points. The model never sees names, never changes the rank, and cannot add a
 * blocked asset class: a reply that mentions one is discarded.
 */

const SYSTEM = [
  "You rewrite short talking points for a relationship manager at an Indian investment firm.",
  "Input: a JSON object with `points` (the draft points) and `facts` (plain facts about the customer).",
  "Rules: keep every fact; do not add products, figures, dates or names that are not in the input; do not suggest pitching anything not in the input; plain English, one sentence per point.",
  "Reply with only a JSON array of 2 or 3 strings and nothing else.",
].join(" ");

export function aiTalkingPointsAvailable(env: Record<string, string | undefined> = process.env): boolean {
  return isAnthropicConfigured(env) || isOpenAiConfigured(env);
}

/** Accepts exactly a JSON array of 2-3 non-empty strings of reasonable length, optionally fenced. Anything else is null. */
export function parseTalkingPointReply(text: string): string[] | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) return null;
  if (!value.every((v) => typeof v === "string" && v.trim().length > 0 && v.length <= 200)) return null;
  return (value as string[]).map((v) => v.trim());
}

/** Drops a reply that names a blocked asset class, so an AI rewrite can never re-introduce a pitch the NBA set aside. */
export function respectsBlockedClasses(points: string[], blockedClasses: string[]): boolean {
  const lower = points.map((p) => p.toLowerCase());
  return blockedClasses.every((c) => !lower.some((p) => p.includes(c.toLowerCase())));
}

export async function rewriteTalkingPoints(
  input: { clientId: string; points: string[]; facts: string[]; blockedClasses: string[] },
  deps?: GatewayDeps,
): Promise<string[] | null> {
  if (!aiTalkingPointsAvailable()) return null;
  try {
    const result = await callModel(
      {
        purpose: "rm.talking_points",
        system: SYSTEM,
        user: JSON.stringify({ points: input.points, facts: input.facts }),
        subject: { type: "client", id: input.clientId },
        maxTokens: 300,
        timeoutMs: 20_000,
      },
      deps,
    );
    if (result.kind !== "ok") return null;
    const parsed = parseTalkingPointReply(result.text);
    if (!parsed || !respectsBlockedClasses(parsed, input.blockedClasses)) return null;
    return parsed;
  } catch {
    return null;
  }
}
