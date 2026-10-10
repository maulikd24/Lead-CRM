export type HintRow = {
  suggestionId: string;
  partner: { id: string; name: string; clientCode: string; assignedToId: string | null; isDeleted: boolean; mergedIntoId: string | null };
  /** An unread "ask a manager" request from this RM already exists for this suggestion. */
  requested: boolean;
};

export type DuplicateHint =
  | { kind: "yours"; suggestionId: string; partnerId: string; name: string; clientCode: string }
  | { kind: "elsewhere"; suggestionId: string; requested: boolean };

const MAX = 5;

/**
 * Pure. What an RM is told about possible duplicates of one of THEIR customers. A duplicate that is also theirs is shown in
 * full. One on another RM's list, or unassigned, is shown only as "ask a manager": no name, code, id or owner of the other
 * customer, so the page cannot be used to browse other RMs' customers.
 */
export function buildDuplicateHints(actorId: string, rows: HintRow[]): DuplicateHint[] {
  const out: DuplicateHint[] = [];
  for (const r of rows) {
    if (r.partner.isDeleted || r.partner.mergedIntoId) continue;
    out.push(
      r.partner.assignedToId === actorId
        ? { kind: "yours", suggestionId: r.suggestionId, partnerId: r.partner.id, name: r.partner.name, clientCode: r.partner.clientCode }
        : { kind: "elsewhere", suggestionId: r.suggestionId, requested: r.requested },
    );
    if (out.length === MAX) break;
  }
  return out;
}
