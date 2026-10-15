// Pure mapping between the Wave 2 read APIs (customer memory, product registry) and the engine's plain-data gate context. No database, no clock.
// The thin database side is seams-live.ts. Nothing here reads evidence text: memory items arrive as class, key, value shape, freshness only.
import type { CitationResult } from "@/lib/registry/cite";
import type { DecisionMemory, DecisionMemoryItem } from "@/lib/memory/view";
import { ASSET_CLASSES, PRODUCT_CATEGORY_ASSET_CLASS, isAssetClass, type AssetClass } from "../constants";
import type { DoNotDoItem, ProductStance, RegistryCitations } from "./gate-context";
import type { Candidate } from "./types";

const valueOf = (i: DecisionMemoryItem): Record<string, unknown> => (i.value && typeof i.value === "object" && !Array.isArray(i.value) ? (i.value as Record<string, unknown>) : {});
const classOf = (i: DecisionMemoryItem): AssetClass | null => {
  const a = valueOf(i).assetClass;
  if (typeof a === "string" && isAssetClass(a)) return a;
  const tail = i.key.split(":").slice(-1)[0];
  return isAssetClass(tail) ? tail : null;
};
const day = (d: Date) => d.toISOString().slice(0, 10);

function stanceOf(i: DecisionMemoryItem): ProductStance["stance"] {
  const s = String(valueOf(i).stance ?? "").toLowerCase();
  if (s === "interested") return "interested";
  if (s === "declined" || s === "not_interested" || s === "not interested") return "not_interested";
  return "objection"; // "low acceptance" and anything softer: can downrank, never block
}

export type MemoryGate = { productStances: ProductStance[]; doNotDo: DoNotDoItem[]; doNotDoUnmapped: number; conflicts: { assetClass: AssetClass | null; because: string }[] };

export function memoryToGate(m: DecisionMemory): MemoryGate {
  const stance = (i: DecisionMemoryItem, confirmed: boolean): ProductStance[] => {
    if (i.class !== "PRODUCT_STANCE") return [];
    const assetClass = classOf(i);
    if (!assetClass) return [];
    return [{ assetClass, stance: stanceOf(i), confirmed, until: i.freshUntil, because: `Customer stance on ${assetClass} recorded in memory on ${day(i.observedAt)}${confirmed ? "" : " (not yet confirmed by a person)"}` }];
  };
  const doNotDo: DoNotDoItem[] = [];
  let unmapped = 0;
  for (const i of m.doNotDo) {
    const assetClass = classOf(i);
    const rule = /^do_not_do:suggestion:(.+)$/.exec(i.key)?.[1] ?? null;
    if (assetClass) doNotDo.push({ assetClass, ruleKey: null, because: `Do not raise ${assetClass}: a confirmed do-not-do note was recorded on ${day(i.observedAt)}` });
    else if (rule) doNotDo.push({ assetClass: null, ruleKey: rule, because: `A person asked not to repeat this suggestion (do-not-do note of ${day(i.observedAt)})` });
    else unmapped++;
  }
  const conflicts = m.contested.flatMap((i) => (i.class === "PRODUCT_STANCE" || i.class === "INTEREST") && classOf(i) ? [{ assetClass: classOf(i), because: `Memory items about ${classOf(i)} are disputed (${i.class === "PRODUCT_STANCE" ? "stance" : "interest"}): confirm with the customer` }] : []);
  return { productStances: [...m.authoritative.flatMap((i) => stance(i, true)), ...m.advisory.flatMap((i) => stance(i, false))], doNotDo, doNotDoUnmapped: unmapped, conflicts };
}

export type RegistryResult = { category: string; id: string; result: Pick<CitationResult, "ok" | "productId"> & { reason?: string } };

/** Which classes have something the registry lets anything cite right now. A class with only refused products carries the first refusal code (example_product, suspended, ...). */
export function citationsFromResults(rows: readonly RegistryResult[], enforced: boolean): RegistryCitations {
  const out: RegistryCitations = { enforced, citable: {}, refused: {} };
  if (!enforced) return out;
  for (const r of rows) {
    const cls = PRODUCT_CATEGORY_ASSET_CLASS[r.category] ?? null;
    if (!cls || !(ASSET_CLASSES as readonly string[]).includes(cls)) continue;
    if (r.result.ok) (out.citable[cls] ??= []).push(r.id);
    else out.refused[cls] ??= r.result.reason ?? "not_citable";
  }
  for (const cls of Object.keys(out.citable) as AssetClass[]) delete out.refused[cls];
  return out;
}

/** The recommendation cites registry ids (never a name it made up): a sale carries the products cite() accepts for its class, with one evidence line each. Unchanged while the registry is off. */
export function attachProductRefs(candidates: Candidate[], registry: RegistryCitations): Candidate[] {
  if (!registry.enforced) return candidates;
  return candidates.map((c) => {
    const ids = c.sales && c.assetClass ? (registry.citable[c.assetClass] ?? []).slice(0, 3) : [];
    if (ids.length === 0) return c;
    return { ...c, productRefs: ids, evidence: [...c.evidence, ...ids.map((id) => ({ kind: "fact" as const, ref: `registry:${id}`, text: "Cites an approved registry product (approved, in date)", observedAt: null, confirmation: "confirmed" as const }))] };
  });
}

type ComplaintSignal = { open: boolean; lastAt: Date | null; because: string | null };
/** Open if either source says open, the latest complaint date wins, and an open one is the one that explains. */
export function mergeComplaintSignals(a: ComplaintSignal | null, b: ComplaintSignal | null): ComplaintSignal {
  const sides = [a, b].filter((x): x is ComplaintSignal => !!x);
  const open = sides.find((x) => x.open);
  const lastAt = sides.reduce<Date | null>((m, x) => (x.lastAt && (!m || x.lastAt.getTime() > m.getTime()) ? x.lastAt : m), null);
  if (open) return { open: true, lastAt, because: open.because };
  const latest = sides.find((x) => x.lastAt && lastAt && x.lastAt.getTime() === lastAt.getTime());
  return { open: false, lastAt, because: latest?.because ?? null };
}
