/**
 * The pure planner behind every rule change (tax rules, override rules): what to write, or why not. A change is one of
 * create, replace (end the old rule where the new one starts, add the new one) or retire (set an end date). History is never
 * rewritten: nothing is edited in place, and an end date or a replacement start cannot be in the past.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export type Dated = { id: string; effectiveFrom: string; effectiveTo: string | null };
export type RuleChange = { op: "create"; rule: Record<string, unknown> } | { op: "replace"; ruleId: string; rule: Record<string, unknown> } | { op: "retire"; ruleId: string; effectiveTo: string };
export type RuleWrite<N> = { type: "create"; data: N } | { type: "end"; id: string; effectiveTo: string };
export type RulePlan<N> = { ok: true; writes: RuleWrite<N>[]; summary: string } | { ok: false; errors: string[] };

export type RuleAdapter<R extends Dated, N extends Omit<R, "id">> = {
  validate(raw: Record<string, unknown>): { ok: true; rule: N } | { ok: false; errors: string[] };
  overlap(existing: R[], candidate: R, ignoreId?: string): string | null;
  describe(rule: R): string;
  noun: string;
};

/** Midnight India time at the start of the day `now` falls in, as an instant. */
export function istDayStart(now: Date): number {
  const local = new Date(now.getTime() + IST_OFFSET_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - IST_OFFSET_MS;
}

function dateOf(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const t = v.trim();
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(t) ? Date.parse(`${t}T00:00:00.000Z`) - IST_OFFSET_MS : Date.parse(t);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function planRuleChange<R extends Dated, N extends Omit<R, "id">>(change: RuleChange, existing: R[], now: Date, a: RuleAdapter<R, N>): RulePlan<N> {
  const today = istDayStart(now);
  const fail = (...errors: string[]): RulePlan<N> => ({ ok: false, errors });

  if (change.op === "create" || change.op === "replace") {
    const v = a.validate(change.rule);
    if (!v.ok) return fail(...v.errors);
    const candidate = { ...v.rule, id: "__new__" } as unknown as R;
    const old = change.op === "replace" ? existing.find((r) => r.id === change.ruleId) : undefined;
    if (change.op === "replace") {
      if (!old) return fail(`That ${a.noun} no longer exists.`);
      if (Date.parse(candidate.effectiveFrom) < today) return fail("A replacement cannot start in the past: history is never rewritten.");
      if (Date.parse(candidate.effectiveFrom) <= Date.parse(old.effectiveFrom)) return fail(`The replacement must start after the ${a.noun} it replaces.`);
      if (old.effectiveTo !== null && Date.parse(old.effectiveTo) <= Date.parse(candidate.effectiveFrom)) return fail(`That ${a.noun} has already ended before the replacement starts.`);
    }
    const clash = a.overlap(existing, candidate, old?.id);
    if (clash) {
      const other = existing.find((r) => r.id === clash);
      return fail(`It overlaps another ${a.noun}${other ? ` (${a.describe(other)})` : ""} with the same reach. End that one first, or choose different dates.`);
    }
    const writes: RuleWrite<N>[] = [];
    if (old) writes.push({ type: "end", id: old.id, effectiveTo: candidate.effectiveFrom });
    writes.push({ type: "create", data: v.rule });
    return { ok: true, writes, summary: `${old ? "Replace" : "Add"} ${a.noun}: ${a.describe(candidate)}` };
  }

  if (change.op === "retire") {
    const old = existing.find((r) => r.id === change.ruleId);
    if (!old) return fail(`That ${a.noun} no longer exists.`);
    const end = dateOf(change.effectiveTo);
    if (!end) return fail("Give the date the rule ends.");
    if (Date.parse(end) < today) return fail("A rule cannot be ended in the past: history is never rewritten.");
    if (Date.parse(end) <= Date.parse(old.effectiveFrom)) return fail("The end date must be after the rule starts.");
    if (old.effectiveTo !== null && Date.parse(end) >= Date.parse(old.effectiveTo)) return fail("That rule already ends sooner. A change can only shorten it.");
    return { ok: true, writes: [{ type: "end", id: old.id, effectiveTo: end }], summary: `End ${a.noun}: ${a.describe(old)}` };
  }
  return fail("Unknown change.");
}
