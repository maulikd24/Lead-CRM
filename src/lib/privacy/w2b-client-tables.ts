/**
 * The seam for the FK / entity relationship registry. Wave 1's allvest/w1-events adds a registry that drives merge, erasure and
 * data-health from one list; it is not on this branch. Until it lands, every Wave 2 workstream B table that points at a Client is
 * listed HERE, and w2b-client-tables.test.ts fails when a table with a Client foreign key appears in this migration without a row,
 * or when a listed table is missing from the erasure transaction or the merge flow. At integration, register these rows in the
 * w1-events registry and delete this file together with its test.
 */
export type ClientOwnedTable = {
  /** Prisma model name. */
  model: string;
  /** The Prisma client delegate key used in the erasure transaction and the merge flow. */
  delegate: string;
  /** Columns that hold a Client id. */
  clientColumns: readonly string[];
  /** Erasure removes every row (children cascade). */
  erase: "delete";
  /** Merge re-points the column(s) to the surviving customer. */
  merge: "reparent";
};

export const W2B_CLIENT_TABLES: readonly ClientOwnedTable[] = [
  { model: "CustomerMemoryItem", delegate: "customerMemoryItem", clientColumns: ["clientId"], erase: "delete", merge: "reparent" },
  { model: "Complaint", delegate: "complaint", clientColumns: ["clientId"], erase: "delete", merge: "reparent" },
  { model: "Commitment", delegate: "commitment", clientColumns: ["clientId"], erase: "delete", merge: "reparent" },
  { model: "HouseholdRelationshipConsent", delegate: "householdRelationshipConsent", clientColumns: ["subjectClientId", "granteeClientId"], erase: "delete", merge: "reparent" },
];
