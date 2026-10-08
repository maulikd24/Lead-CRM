"use server";

import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { rateLimit } from "@/lib/security/rate-limit";
import { askTheSystem } from "@/lib/intelligence/ask";
import { managementScope, type CustomerRow } from "@/lib/intelligence/management";


export type AskResponse = { ok: true; answer: string; customers: CustomerRow[] } | { ok: false; error: string };

/** Management questions in plain English, answered from live data and limited to the asker's own customers. */
export async function askSystemAction(question: string): Promise<AskResponse> {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const text = question.trim();
  if (text.length < 5) return { ok: false, error: "Ask a full question, for example “Which KYC customers have not funded?”" };

  const limited = await rateLimit("ask-system", session.user.id, { limit: 20, windowSeconds: 3600 });
  if (!limited.allowed) return { ok: false, error: "You've asked a lot of questions this hour — try again shortly." };

  try {
    const visible = await getVisibleUserIds(session.user.id, session.user.role);
    const { answer, customers } = await askTheSystem(text, managementScope(visible, session.user.role === "MANAGER"), visible);
    return { ok: true, answer, customers };
  } catch (error) {
    console.error("Ask the system failed", error);
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't answer that right now." };
  }
}
