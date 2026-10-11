/**
 * Routing rules for a lead that arrives with a campaign code: who is the responsible owner. Pure.
 *
 * First match wins: lowest priority number, then the rule with more conditions. An empty condition list means "any";
 * a rule with no conditions at all never matches (only the fallback is allowed to be unconditional). When nothing
 * matches and there is no fallback, the decision is "none" and the existing lead assignment (region, language,
 * capacity, round robin) decides exactly as it does today: this module only adds an earlier, campaign-aware step.
 */
export type RoutingRule = {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  cities: string[];
  languages: string[];
  products: string[];
  audienceKey: string | null;
  ownerId: string | null;
  ownerLabel: string | null;
  isFallback: boolean;
};

export type LeadFacts = { city?: string | null; language?: string | null; product?: string | null; audienceKey?: string | null };
export type RoutingDecision = { via: "rule" | "fallback" | "none"; ownerId: string | null; ownerLabel: string | null; rule: RoutingRule | null };

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
const listHas = (list: string[], v: string | null | undefined) => list.some((x) => norm(x) === norm(v));
export const conditionCount = (r: Pick<RoutingRule, "cities" | "languages" | "products" | "audienceKey">): number => (r.cities.length ? 1 : 0) + (r.languages.length ? 1 : 0) + (r.products.length ? 1 : 0) + (r.audienceKey ? 1 : 0);

/** Why a rule does or does not match this lead; empty `misses` means it matches. */
function evaluate(rule: RoutingRule, lead: LeadFacts): { matched: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const misses: string[] = [];
  if (rule.cities.length) (listHas(rule.cities, lead.city) ? reasons : misses).push(listHas(rule.cities, lead.city) ? `city ${lead.city} is listed` : `city ${lead.city || "(none)"} is not in ${rule.cities.join(", ")}`);
  if (rule.languages.length) (listHas(rule.languages, lead.language) ? reasons : misses).push(listHas(rule.languages, lead.language) ? `language ${lead.language} is listed` : `language ${lead.language || "(none)"} is not in ${rule.languages.join(", ")}`);
  if (rule.products.length) (listHas(rule.products, lead.product) ? reasons : misses).push(listHas(rule.products, lead.product) ? `product ${lead.product} is listed` : `product ${lead.product || "(none)"} is not in ${rule.products.join(", ")}`);
  if (rule.audienceKey) (norm(rule.audienceKey) === norm(lead.audienceKey) ? reasons : misses).push(norm(rule.audienceKey) === norm(lead.audienceKey) ? `audience is ${rule.audienceKey}` : `audience ${lead.audienceKey || "(none)"} is not ${rule.audienceKey}`);
  return misses.length ? { matched: false, reasons: misses } : { matched: true, reasons };
}

const byOrder = (a: RoutingRule, b: RoutingRule) => a.priority - b.priority || conditionCount(b) - conditionCount(a) || (a.id < b.id ? -1 : 1);
const usable = (r: RoutingRule) => r.enabled && !!r.ownerId;

export function resolveOwner(rules: RoutingRule[], lead: LeadFacts): RoutingDecision {
  const hit = rules.filter((r) => usable(r) && !r.isFallback && conditionCount(r) > 0 && evaluate(r, lead).matched).sort(byOrder)[0];
  if (hit) return { via: "rule", ownerId: hit.ownerId, ownerLabel: hit.ownerLabel, rule: hit };
  const fb = rules.filter((r) => usable(r) && r.isFallback).sort(byOrder)[0];
  if (fb) return { via: "fallback", ownerId: fb.ownerId, ownerLabel: fb.ownerLabel, rule: fb };
  return { via: "none", ownerId: null, ownerLabel: null, rule: null };
}

export type TraceRow = { rule: RoutingRule; matched: boolean; chosen: boolean; reasons: string[]; note: string | null };
export type RoutingPreview = { decision: RoutingDecision; trace: TraceRow[] };

/** The "test this rule" view: every rule in order with the reason it matched or not, and the final decision. */
export function previewRouting(rules: RoutingRule[], lead: LeadFacts): RoutingPreview {
  const decision = resolveOwner(rules, lead);
  const trace = [...rules].sort(byOrder).map((rule): TraceRow => {
    const chosen = decision.rule?.id === rule.id;
    const row = (matched: boolean, reasons: string[], note: string | null): TraceRow => ({ rule, matched, chosen, reasons, note });
    if (!rule.enabled) return row(false, ["Switched off"], null);
    if (!rule.ownerId) return row(false, ["Names nobody as owner yet"], null);
    if (rule.isFallback) return row(chosen, [], "This is the fallback: it is used only when no other rule matches.");
    if (conditionCount(rule) === 0) return row(false, ["Has no conditions"], null);
    const e = evaluate(rule, lead);
    return row(e.matched, e.reasons, e.matched && !chosen ? "Matches, but a rule above it was chosen." : null);
  });
  return { decision, trace };
}

export function validateRule(r: Pick<RoutingRule, "name" | "cities" | "languages" | "products" | "audienceKey" | "isFallback">): string[] {
  const errors: string[] = [];
  if (!r.name.trim()) errors.push("Give the rule a name.");
  if (!r.isFallback && conditionCount(r) === 0) errors.push("Add at least one condition, or make this the fallback.");
  return errors;
}
