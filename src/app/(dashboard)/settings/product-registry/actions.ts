"use server";

import { revalidatePath } from "next/cache";

import { requireAccess } from "@/lib/auth/require-role";
import { formToContentInput, type FormFields } from "@/lib/registry/form-parse";
import * as registry from "@/lib/registry/service";

/**
 * The Product registry's server actions. ADMIN only through the central registry (area "settings-product-registry", action "manage"),
 * and each one re-checks the role again inside the service (a second, independent guard). Each is one audited transaction.
 * Nothing here sends a message or touches a customer.
 */
const PATH = "/settings/product-registry";

type Res = { ok: true; message: string; productId?: string } | { ok: false; error: string };
const asText = (v: unknown, max = 4000): string => (typeof v === "string" ? v.slice(0, max) : "");
const FIELD_KEYS: (keyof FormFields)[] = ["name", "category", "summary", "availability", "minInvestment", "currency", "riskCategory", "jurisdictions", "requiredDocuments", "eligibility", "restrictions", "claims", "validFrom", "validTo"];
const fieldsOf = (raw: Partial<FormFields>): FormFields => Object.fromEntries(FIELD_KEYS.map((k) => [k, asText(raw?.[k])])) as FormFields;
const idOf = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 64 ? v : null);

async function actor() {
  const session = await requireAccess("settings-product-registry", "manage");
  return { userId: session.user.id, role: session.user.role as string };
}
const done = (r: { ok: true } | { ok: false; error: string }, message: string, extra: { productId?: string } = {}): Res => {
  if (r.ok) revalidatePath(PATH);
  return r.ok ? { ok: true, message, ...extra } : { ok: false, error: r.error };
};

export async function createProductAction(key: string, fields: Partial<FormFields>, isExample = false): Promise<Res> {
  const a = await actor();
  const r = await registry.createProduct({ key: asText(key, 80).trim().toLowerCase(), content: formToContentInput(fieldsOf(fields)), isExample: isExample === true }, a);
  return r.ok ? done(r, "Draft created. Submit it for review when it is ready.", { productId: r.productId }) : done(r, "");
}

export async function updateDraftAction(versionId: string, fields: Partial<FormFields>): Promise<Res> {
  const a = await actor();
  const id = idOf(versionId);
  return id ? done(await registry.updateDraft(id, formToContentInput(fieldsOf(fields)), a), "Draft saved.") : { ok: false, error: "Version not found." };
}

export async function reviseProductAction(productId: string): Promise<Res> {
  const a = await actor();
  const id = idOf(productId);
  return id ? done(await registry.reviseProduct(id, a), "A new draft was created from the current version.") : { ok: false, error: "Product not found." };
}

export async function submitVersionAction(versionId: string): Promise<Res> {
  const a = await actor();
  const id = idOf(versionId);
  return id ? done(await registry.submitVersion(id, a), "Submitted for review. A second Admin must approve it.") : { ok: false, error: "Version not found." };
}

export async function decideVersionAction(versionId: string, decision: "approve" | "reject", note: string): Promise<Res> {
  const a = await actor();
  const id = idOf(versionId);
  if (!id || (decision !== "approve" && decision !== "reject")) return { ok: false, error: "Version not found." };
  return done(await registry.decideVersion(id, decision, asText(note, 500).trim() || null, a), decision === "approve" ? "Approved. This version is now the one agents and campaigns may cite." : "Rejected. The product is unchanged.");
}

export async function suspendProductAction(productId: string, reason: string): Promise<Res> {
  const a = await actor();
  const id = idOf(productId);
  return id ? done(await registry.suspendProduct(id, asText(reason, 500), a), "Suspended. It can no longer be cited anywhere.") : { ok: false, error: "Product not found." };
}

export async function retireProductAction(productId: string, reason: string): Promise<Res> {
  const a = await actor();
  const id = idOf(productId);
  return id ? done(await registry.retireProduct(id, asText(reason, 500), a), "Retired for good. It can no longer be cited.") : { ok: false, error: "Product not found." };
}
