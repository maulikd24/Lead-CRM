import { describe, expect, it } from "vitest";

import { customerLinks, scanSchema } from "./schema-scan";

const SCHEMA = `
model Client {
  id String @id
  mergedIntoId String?
  kyc KycRecord?
}
model KycRecord {
  id String @id
  clientId String @unique
  client Client @relation(fields: [clientId], references: [id])
}
model MergeSuggestion {
  id String @id
  clientAId String
  clientBId String
  clientA Client @relation("MergeA", fields: [clientAId], references: [id])
  clientB Client @relation("MergeB", fields: [clientBId], references: [id], onDelete: Cascade)
}
model TradingAccount {
  id String @id
  clientId String
  client Client @relation(fields: [clientId], references: [id])
}
model Position {
  id String @id
  tradingAccountId String
  tradingAccount TradingAccount @relation(fields: [tradingAccountId], references: [id])
}
model Lot {
  id String @id
  positionId String
  position Position @relation(fields: [positionId], references: [id])
}
model LeadIntake {
  id String @id
  clientId String?
}
model Unrelated {
  id String @id
  userId String
}
`;

describe("scanSchema", () => {
  const scan = scanSchema(SCHEMA);
  it("lists models and foreign keys with their columns and delete rule", () => {
    expect(scan.models).toContain("Position");
    expect(scan.fks.find((f) => f.model === "MergeSuggestion" && f.field === "clientB")).toMatchObject({ target: "Client", columns: ["clientBId"], onDelete: "Cascade" });
  });
  it("lists plain id columns that are not foreign keys", () => {
    expect(scan.plainIds).toContainEqual({ model: "LeadIntake", column: "clientId" });
    expect(scan.plainIds.find((p) => p.model === "KycRecord")).toBeUndefined();
  });
});

describe("customerLinks", () => {
  const links = customerLinks(scanSchema(SCHEMA), "Client");
  const link = (m: string) => links.find((l) => l.model === m);
  it("finds direct foreign keys, every column of a two-column model", () => {
    expect(link("KycRecord")).toEqual({ model: "KycRecord", kind: "direct_fk", paths: [{ via: [], column: "clientId" }] });
    expect(link("MergeSuggestion")).toEqual({ model: "MergeSuggestion", kind: "direct_fk", paths: [{ via: [], column: "clientAId" }, { via: [], column: "clientBId" }] });
  });
  it("finds plain id columns", () => expect(link("LeadIntake")).toEqual({ model: "LeadIntake", kind: "plain_id", paths: [{ via: [], column: "clientId" }] }));
  it("finds indirect links through one or more foreign keys, with the relation path", () => {
    expect(link("Position")).toEqual({ model: "Position", kind: "indirect", paths: [{ via: ["tradingAccount"], column: "clientId" }] });
    expect(link("Lot")).toEqual({ model: "Lot", kind: "indirect", paths: [{ via: ["position", "tradingAccount"], column: "clientId" }] });
  });
  it("a model with a direct link lists only its direct columns (a second route is a modelling fact the registry states by hand)", () => {
    const l = customerLinks(scanSchema(`
model Client { id String @id }
model Referrer { id String @id
  clientId String @unique
  client Client @relation(fields: [clientId], references: [id]) }
model Referral { id String @id
  referrerId String
  referredClientId String?
  referrer Referrer @relation(fields: [referrerId], references: [id])
  referredClient Client? @relation(fields: [referredClientId], references: [id]) }`), "Client");
    expect(l.find((x) => x.model === "Referral")).toEqual({ model: "Referral", kind: "direct_fk", paths: [{ via: [], column: "referredClientId" }] });
  });
  it("an indirect table keeps only the shortest chain", () => {
    const l = customerLinks(scanSchema(`
model Client { id String @id }
model A { id String @id
  clientId String
  client Client @relation(fields: [clientId], references: [id]) }
model B { id String @id
  aId String
  a A @relation(fields: [aId], references: [id]) }
model C { id String @id
  aId String
  bId String
  a A @relation(fields: [aId], references: [id])
  b B @relation(fields: [bId], references: [id]) }`), "Client");
    expect(l.find((x) => x.model === "C")).toEqual({ model: "C", kind: "indirect", paths: [{ via: ["a"], column: "clientId" }] });
  });
  it("ignores models with no link to the customer, and the customer itself", () => {
    expect(link("Unrelated")).toBeUndefined();
    expect(link("Client")).toBeUndefined();
  });
});
