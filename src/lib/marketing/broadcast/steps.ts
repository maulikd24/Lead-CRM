import { scheduleIssue, type BroadcastDraft } from "./schema";

/** The four Campaign Studio steps. Pure: the wizard renders these rules and the tests pin them. */
export const STUDIO_STEPS = [
  { n: 1, key: "audience", label: "Audience" },
  { n: 2, key: "template", label: "Channel & template" },
  { n: 3, key: "content", label: "Content" },
  { n: 4, key: "review", label: "Review" },
] as const;
export type StepNumber = (typeof STUDIO_STEPS)[number]["n"];

export type StepContext = {
  /** Consented customers matching the audience; null while it is being counted. */
  consented: number | null;
  /** The chosen template's placeholder keys, or null when none is chosen (or it is not one of the approved ones). */
  templateVariables: string[] | null;
  now: Date;
};

export function parseStep(v: string | string[] | undefined | null): StepNumber {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return n === 2 || n === 3 || n === 4 ? n : 1;
}

/** Why a step cannot be left yet (empty when it can). */
export function stepIssues(step: StepNumber, d: BroadcastDraft, ctx: StepContext): string[] {
  switch (step) {
    case 1:
      if (ctx.consented === null) return ["Counting the audience…"];
      return ctx.consented === 0 ? ["No customer in this audience has agreed to marketing messages on this channel. Widen it."] : [];
    case 2:
      return d.templateId && ctx.templateVariables ? [] : ["Pick an approved template."];
    case 3: {
      const missing = (ctx.templateVariables ?? []).filter((k) => !d.variables[k]?.trim());
      return missing.length ? [`Fill in ${missing.map((k) => `{{${k}}}`).join(", ")}.`] : [];
    }
    case 4: {
      const out: string[] = [];
      if (d.name.trim().length < 3) out.push("Give the broadcast a name of at least 3 characters.");
      const s = scheduleIssue(d.scheduledFor, ctx.now);
      if (s) out.push(s);
      return out;
    }
  }
}

/** The furthest step a person may open: every step before it is complete. Deep links past an incomplete step land on it instead. */
export function furthestReachable(d: BroadcastDraft, ctx: StepContext): StepNumber {
  for (const s of [1, 2, 3] as const) if (stepIssues(s, d, ctx).length) return s;
  return 4;
}
