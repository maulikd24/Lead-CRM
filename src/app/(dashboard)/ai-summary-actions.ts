"use server";

import { z } from "zod";

import { requireUser } from "@/lib/auth/require-role";
import { generateSummary, AiNotConfiguredError } from "@/lib/ai/summaries/generate";
import {
  buildClientFacts,
  buildManagementFacts,
  buildMyDayFacts,
  buildQualityReviewFacts,
  buildRmIndividualFacts,
  buildRmOverallFacts,
  type SummaryUser,
} from "@/lib/ai/summaries/builders";
import type { Role } from "@/generated/prisma/client";

const inputSchema = z.object({
  kind: z.enum(["client", "my_day", "management", "reports", "quality_review", "rm_individual", "rm_overall"]),
  /** clientId for "client", reviewId for "quality_review", rmId for "rm_individual". */
  subjectId: z.string().optional(),
  /** Period query params: Manager Dashboard (period / anchor / from / to) or the RM page (pillarsFrom / pillarsTo). */
  period: z.record(z.string(), z.string()).optional(),
  force: z.boolean().optional(),
});

export type SummaryResult =
  | { ok: true; summary: string; cached: boolean; generatedAt: string; model: string }
  | { ok: false; error: string; notConfigured?: boolean };

const ALLOWED_ROLES: Record<z.infer<typeof inputSchema>["kind"], Role[]> = {
  client: ["ADMIN", "MANAGER", "RM"],
  my_day: ["ADMIN", "MANAGER", "RM"],
  management: ["ADMIN", "MANAGER"],
  reports: ["ADMIN", "MANAGER"],
  quality_review: ["ADMIN", "MANAGER", "RM"],
  rm_individual: ["ADMIN", "MANAGER"],
  rm_overall: ["ADMIN", "MANAGER"],
};

/**
 * One entry point for every "Summarize this page" button. Role gate first, then the builder enforces the same
 * record-level visibility the page itself does. Never throws to the UI — errors come back as { ok: false }.
 */
export async function summarizePageAction(rawInput: z.input<typeof inputSchema>): Promise<SummaryResult> {
  const session = await requireUser();
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  const input = parsed.data;

  if (!ALLOWED_ROLES[input.kind].includes(session.user.role)) return { ok: false, error: "You don't have access to this summary" };

  const user: SummaryUser = { id: session.user.id, role: session.user.role, name: session.user.name };
  try {
    let built;
    switch (input.kind) {
      case "client":
        if (!input.subjectId) return { ok: false, error: "Missing client" };
        built = await buildClientFacts(input.subjectId, user);
        break;
      case "my_day":
        built = await buildMyDayFacts(user);
        break;
      case "management":
      case "reports":
        built = await buildManagementFacts(user, input.kind, input.period ?? {});
        break;
      case "quality_review":
        if (!input.subjectId) return { ok: false, error: "Missing review" };
        built = await buildQualityReviewFacts(input.subjectId, user);
        break;
      case "rm_individual":
        if (!input.subjectId) return { ok: false, error: "Missing RM" };
        built = await buildRmIndividualFacts(input.subjectId, user, input.period ?? {});
        break;
      case "rm_overall":
        built = await buildRmOverallFacts(user, input.period ?? {});
        break;
    }

    const result = await generateSummary({
      kind: input.kind,
      subjectKey: built.subjectKey,
      userId: user.id,
      instruction: built.instruction,
      facts: built.facts,
      force: input.force,
    });
    return { ok: true, summary: result.summary, cached: result.cached, generatedAt: result.generatedAt.toISOString(), model: result.model };
  } catch (error) {
    if (error instanceof AiNotConfiguredError) return { ok: false, error: error.message, notConfigured: true };
    console.error("AI summary failed", error);
    return { ok: false, error: error instanceof Error && error.message ? error.message : "Couldn't generate a summary" };
  }
}
