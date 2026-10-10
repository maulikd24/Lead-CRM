import { formatPaise, parseRate, parseUnits, ratePaise } from "../native/money";
import { MAX_OVERRIDE_LEVEL, type OverrideRule } from "./rules";

/**
 * Override accruals: a percentage of a sub-partner's commission accrual, paid to an ancestor in the commercial roll-up. Pure
 * exact-integer maths (the statement's BigInt units); the engine's own accrual semantics are untouched. With no rule there is no line.
 */
export type OverrideSource = {
  accrualId: string;
  partnerId: string;
  /** The sub-partner's commission accrual, an exact decimal string (negative for a clawback). */
  amount: string;
  accrualDate: string;
  /** The partner's ancestors, nearest first (level 1 first). */
  ancestors: { id: string; status: string }[];
};

export type OverrideAccrual = {
  /** "<source accrual>:<rule>:<ancestor>": what makes the generator idempotent. */
  key: string;
  sourceAccrualId: string;
  ruleId: string;
  partnerId: string;
  level: number;
  amount: string;
  capped: boolean;
  accrualDate: string;
};

const ZERO = BigInt(0);

/** The ancestors of a partner, nearest first, up to `maxLevel`. A cycle in the data cannot loop. */
export function ancestorsOf(id: string, parentOf: Map<string, string | null>, maxLevel: number = MAX_OVERRIDE_LEVEL): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cur = parentOf.get(id) ?? null;
  while (cur && out.length < maxLevel && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return out;
}

const activeAt = (r: OverrideRule, at: number) => Date.parse(r.effectiveFrom) <= at && (r.effectiveTo === null || at < Date.parse(r.effectiveTo));

export function computeOverrides(source: OverrideSource, rules: OverrideRule[]): OverrideAccrual[] {
  const units = parseUnits(source.amount);
  if (units === ZERO) return [];
  const at = Date.parse(source.accrualDate);
  const out: OverrideAccrual[] = [];
  for (const rule of [...rules].sort((a, b) => a.level - b.level || a.id.localeCompare(b.id))) {
    if (!activeAt(rule, at)) continue;
    const ancestor = source.ancestors[rule.level - 1];
    if (!ancestor || ancestor.status === "TERMINATED") continue;
    let paise = ratePaise(units, parseRate(rule.ratePercent));
    let capped = false;
    if (rule.capPerAccrual !== null) {
      const cap = ratePaise(parseUnits(rule.capPerAccrual), parseRate("100"));
      const abs = paise < ZERO ? -paise : paise;
      if (abs > cap) {
        paise = paise < ZERO ? -cap : cap;
        capped = true;
      }
    }
    if (paise === ZERO) continue;
    out.push({ key: `${source.accrualId}:${rule.id}:${ancestor.id}`, sourceAccrualId: source.accrualId, ruleId: rule.id, partnerId: ancestor.id, level: rule.level, amount: formatPaise(paise), capped, accrualDate: source.accrualDate });
  }
  return out;
}

export type ExistingOverride = { key: string; amount: string; status: string };

/** What to write so the stored override accruals match the computed ones: create the missing, update an open one that changed, never touch one already in a payout. */
export function diffOverrides(computed: OverrideAccrual[], existing: ExistingOverride[]) {
  const byKey = new Map(existing.map((e) => [e.key, e]));
  const create: OverrideAccrual[] = [];
  const update: { key: string; amount: string }[] = [];
  let unchanged = 0;
  for (const c of computed) {
    const e = byKey.get(c.key);
    if (!e) create.push(c);
    else if (e.status === "ACCRUED" && parseUnits(e.amount) !== parseUnits(c.amount)) update.push({ key: c.key, amount: c.amount });
    else unchanged += 1;
  }
  return { create, update, unchanged };
}
