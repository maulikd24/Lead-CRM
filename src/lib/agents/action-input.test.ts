import { describe, expect, it } from "vitest";
import { parseApproveInput, parseRejectInput } from "./action-input";

describe("parseApproveInput", () => {
  it("accepts an id with no edit", () => {
    expect(parseApproveInput("abc", undefined)).toEqual({ ok: true, proposalId: "abc", editedBody: undefined });
  });
  it("accepts an edited body of exactly 1000 chars", () => {
    const body = "a".repeat(1000);
    expect(parseApproveInput("abc", body)).toEqual({ ok: true, proposalId: "abc", editedBody: body });
  });
  it("rejects a 1001-char edited body", () => {
    expect(parseApproveInput("abc", "a".repeat(1001))).toEqual({ ok: false, error: "Invalid request" });
  });
  it.each([[42], [{}], [["x"]], [null]])("rejects non-string editedBody %j", (v) => {
    expect(parseApproveInput("abc", v)).toEqual({ ok: false, error: "Invalid request" });
  });
  it.each([[42], [""], [undefined], [{}], ["x".repeat(101)]])("rejects bad id %j", (v) => {
    expect(parseApproveInput(v, undefined)).toEqual({ ok: false, error: "Invalid request" });
  });
});

describe("parseRejectInput", () => {
  it("accepts a valid id", () => {
    expect(parseRejectInput("abc")).toEqual({ ok: true, proposalId: "abc" });
  });
  it.each([[42], [""], [null], ["x".repeat(101)]])("rejects bad id %j", (v) => {
    expect(parseRejectInput(v)).toEqual({ ok: false, error: "Invalid request" });
  });
});
