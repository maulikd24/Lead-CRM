import { prisma } from "@/lib/db/prisma";
import { emailKey, phoneKey } from "@/lib/clients/identity-keys";
import { normalizePan } from "@/lib/utils/normalize-contact";

export type DuplicateInfo = {
  id: string;
  name: string;
  clientCode: string;
  mobile: string | null;
  email: string | null;
};

/** Server-side only: carries the owner so the caller's scope can be applied before anything is returned. */
export type RawDuplicateCheck = Omit<DuplicateCheckResult, "duplicate"> & { duplicate: (DuplicateInfo & { assignedToId: string | null }) | null };

export type DuplicateCheckResult = {
  duplicate: DuplicateInfo | null;
  reason: "pan" | "ckycRef" | "mobile" | "email" | null;
  blocking: boolean;
};

const DUPLICATE_SELECT = { id: true, name: true, clientCode: true, mobile: true, email: true, assignedToId: true } as const;

export async function findDuplicateClient(
  mobile: string | undefined,
  email: string,
  pan?: string,
  ckycRef?: string,
  excludeId?: string,
): Promise<RawDuplicateCheck> {
  const notSelf = excludeId ? { id: { not: excludeId } } : {};

  // PAN and CKYC ref are unique government/regulatory identifiers — an exact match is a hard
  // block (merge, don't create/edit), unlike the overridable email soft-duplicate check below.
  // PAN is optional at creation, so skip this check entirely rather than query on an empty string.
  const trimmedPan = pan?.trim();
  if (trimmedPan) {
    const normalizedPan = normalizePan(trimmedPan);
    const panMatch = await prisma.client.findFirst({
      where: { pan: normalizedPan, mergedIntoId: null, isDeleted: false, ...notSelf },
      select: DUPLICATE_SELECT,
    });
    if (panMatch) return { duplicate: panMatch, reason: "pan", blocking: true };
  }

  const trimmedCkycRef = ckycRef?.trim();
  if (trimmedCkycRef) {
    const ckycMatch = await prisma.client.findFirst({
      where: { ckycRef: trimmedCkycRef, mergedIntoId: null, isDeleted: false, ...notSelf },
      select: DUPLICATE_SELECT,
    });
    if (ckycMatch) return { duplicate: ckycMatch, reason: "ckycRef", blocking: true };
  }

  // Mobile is a hard block too, same tier as PAN/CKYC — no override. Checked both exact and
  // normalized (country code/spacing/dashes) since it's not a DB-unique column (see note at the
  // call site in checkDuplicateClientAction's callers about why no @unique constraint was added).
  // Mobile is optional (an inbound Email/Live Chat contact may have none at all) — skip this
  // block entirely rather than query on it: a bare `where: { mobile: undefined }` wouldn't filter
  // at all (Prisma strips undefined values from a where clause), which would otherwise match the
  // first arbitrary client in the table and misreport a duplicate.
  // Mobile is optional (an inbound Email/Live Chat contact may have none at all). Matched on the normalized key
  // (src/lib/clients/identity-keys.ts) — the same rule every lead source uses — via an index, not a table scan.
  const mobileKeyValue = phoneKey(mobile);
  if (mobileKeyValue) {
    const mobileMatch = await prisma.client.findFirst({
      where: { mobileKey: mobileKeyValue, mergedIntoId: null, isDeleted: false, ...notSelf },
      select: DUPLICATE_SELECT,
      orderBy: { createdAt: "asc" },
    });
    if (mobileMatch) return { duplicate: mobileMatch, reason: "mobile", blocking: true };
  }

  // Email stays a soft, overridable warning (and, as before, ignores clients marked Not proceeding here — inbound
  // contacts are matched to those through resolveInboundClient/findClientByIdentity instead).
  const emailKeyValue = emailKey(email);
  if (!emailKeyValue) return { duplicate: null, reason: null, blocking: false };
  const emailMatch = await prisma.client.findFirst({
    where: { status: { not: "NOT_PROCEEDING" }, mergedIntoId: null, isDeleted: false, emailKey: emailKeyValue, ...notSelf },
    select: DUPLICATE_SELECT,
    orderBy: { createdAt: "asc" },
  });
  return { duplicate: emailMatch, reason: emailMatch ? "email" : null, blocking: false };
}
