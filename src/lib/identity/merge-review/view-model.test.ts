import { describe, expect, it } from "vitest";
import { buildComparison, confidenceOf, countRows, firstName, reasonText, type CardInput } from "./view-model";

const card = (over: Partial<CardInput> = {}): CardInput => ({
  id: "a", name: "Riya Sharma", clientCode: "CL-00001", mobile: "98765 43210", email: "riya@example.com", pan: null, city: "Pune",
  leadSource: "Website", stage: "KYC", kyc: "Not started", funding: "Not started", assignedTo: "Asha", lastActivityAt: null, createdAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});

describe("firstName", () => {
  it("returns only the first token", () => {
    expect(firstName("Riya Kumari Sharma")).toBe("Riya");
    expect(firstName("  Riya ")).toBe("Riya");
    expect(firstName("")).toBe("Customer");
  });
});

describe("reasonText", () => {
  it("turns scorer reasons into plain language, passing unknown ones through safely", () => {
    expect(reasonText("same mobile")).toBe("Same mobile number");
    expect(reasonText("similar name")).toBe("Similar name");
    expect(reasonText("same email")).toBe("Same email address");
    expect(reasonText("same PAN")).toBe("Same PAN");
    expect(reasonText("weird thing")).toBe("Weird thing");
  });
});

describe("confidenceOf", () => {
  it("is a clamped whole percentage with a label", () => {
    expect(confidenceOf(0.98)).toEqual({ percent: 98, label: "Very likely the same person" });
    expect(confidenceOf(0.85)).toEqual({ percent: 85, label: "Likely the same person" });
    expect(confidenceOf(0.7).label).toBe("Possibly the same person");
    expect(confidenceOf(2).percent).toBe(100);
    expect(confidenceOf(-1).percent).toBe(0);
  });
});

describe("buildComparison", () => {
  it("masks mobile, email and PAN and never emits the raw value", () => {
    const rows = buildComparison(card({ pan: "ABCDE1234F" }), card({ id: "b", pan: "ABCDE1234F" }));
    const json = JSON.stringify(rows);
    for (const raw of ["98765", "riya@example.com", "ABCDE1234F"]) expect(json).not.toContain(raw);
    expect(rows.find((r) => r.key === "mobile")?.a).toBe("••••3210");
  });
  it("flags same / different / missing from the raw values", () => {
    const rows = buildComparison(
      card({ mobile: "+91 98765 43210", email: "Riya@Example.com", pan: null, city: "Pune" }),
      card({ id: "b", name: "R Sharma", mobile: "9876543210", email: "riya@example.com", pan: "ABCDE1234F", city: "Mumbai" }),
    );
    const by = (k: string) => rows.find((r) => r.key === k)!;
    expect(by("mobile").match).toBe("same");
    expect(by("email").match).toBe("same");
    expect(by("name").match).toBe("different");
    expect(by("pan").match).toBe("missing");
    expect(by("city").match).toBe("different");
  });
  it("marks sensitive rows so the UI can offer a reveal", () => {
    const rows = buildComparison(card(), card({ id: "b" }));
    expect(rows.filter((r) => r.sensitive).map((r) => r.key)).toEqual(["mobile", "email", "pan"]);
  });
  it("treats two blank values as missing, not same", () => {
    const rows = buildComparison(card({ city: null }), card({ id: "b", city: null }));
    expect(rows.find((r) => r.key === "city")?.match).toBe("missing");
  });
  it("includes status rows with human labels", () => {
    const rows = buildComparison(card({ assignedTo: "Asha" }), card({ id: "b", assignedTo: null }));
    expect(rows.find((r) => r.key === "assignedTo")).toMatchObject({ a: "Asha", b: "Unassigned", match: "different" });
  });
});

describe("countRows", () => {
  it("lists history counts and flags differences", () => {
    const z = { activities: 0, messages: 0, tasks: 0, positions: 0, documents: 0, tradingAccounts: 0 };
    const rows = countRows({ ...z, activities: 3 }, { ...z, activities: 1, messages: 0 });
    expect(rows.find((r) => r.key === "count:activities")).toMatchObject({ a: "3", b: "1", match: "different" });
    expect(rows.find((r) => r.key === "count:messages")?.match).toBe("same");
  });
});
