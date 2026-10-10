import { describe, expect, it } from "vitest";
import { mergeClientRecords, type MergeTx } from "./merge";

type Row = { externalId: string; clientId: string };

/** A fake transaction: every model answers "nothing there" unless overridden; records the leadIntake calls. */
function fakeTx(intake: Row[]) {
  const calls: { model: string; method: string; args: unknown }[] = [];
  const overrides: Record<string, Record<string, (args: unknown) => unknown>> = {
    client: {
      updateMany: () => ({ count: 1 }),
      findUnique: (args) => ((args as { where: { id: string } }).where.id === "dup" ? { name: "Dup", clientCode: "C2", pan: null } : { pan: null }),
    },
    leadIntake: {
      findMany: (args) => {
        const ids = (args as { where: { clientId: { in: string[] } } }).where.clientId.in;
        return intake.filter((r) => ids.includes(r.clientId)).map((r) => ({ externalId: r.externalId, clientId: r.clientId }));
      },
      updateMany: () => ({ count: 1 }),
    },
  };
  const tx = new Proxy({}, {
    get: (_t, model: string) =>
      new Proxy({}, {
        get: (_m, method: string) => async (args: unknown) => {
          calls.push({ model, method, args });
          const fn = overrides[model]?.[method];
          if (fn) return fn(args);
          return method === "findMany" ? [] : method === "updateMany" ? { count: 0 } : method === "create" || method === "update" ? {} : null;
        },
      }),
  }) as unknown as MergeTx;
  return { tx, calls };
}

const intakeCalls = (calls: ReturnType<typeof fakeTx>["calls"]) => calls.filter((c) => c.model === "leadIntake");
const auditNewValue = (calls: ReturnType<typeof fakeTx>["calls"]) => (calls.find((c) => c.model === "auditLog")?.args as { data: { newValue: Record<string, unknown> } }).data.newValue;

describe("mergeClientRecords: app signup ledger", () => {
  it("leaves the ledger alone when linking is off (default)", async () => {
    const { tx, calls } = fakeTx([{ externalId: "sub-1", clientId: "dup" }]);
    const out = await mergeClientRecords(tx, "keep", "dup", "actor");
    expect(intakeCalls(calls)).toHaveLength(0);
    expect(out.appUserIdConflict).toBe(false);
  });

  it("re-points the archived customer's ledger rows to the survivor when linking is on", async () => {
    const { tx, calls } = fakeTx([{ externalId: "sub-1", clientId: "dup" }]);
    const out = await mergeClientRecords(tx, "keep", "dup", "actor", { linkAppIds: true });
    expect(intakeCalls(calls).find((c) => c.method === "updateMany")?.args).toEqual({ where: { clientId: "dup" }, data: { clientId: "keep" } });
    expect(out.appUserIdConflict).toBe(false);
  });

  it("two different app user ids: both rows move (both stay findable) and the conflict is reported and audited", async () => {
    const { tx, calls } = fakeTx([{ externalId: "sub-1", clientId: "keep" }, { externalId: "sub-2", clientId: "dup" }]);
    const out = await mergeClientRecords(tx, "keep", "dup", "actor", { linkAppIds: true });
    expect(out.appUserIdConflict).toBe(true);
    expect(intakeCalls(calls).some((c) => c.method === "updateMany")).toBe(true);
    expect(auditNewValue(calls).appUserIdConflict).toBe(true);
    const note = (calls.filter((c) => c.model === "activity" && c.method === "create")[0].args as { data: { payload: { message: string } } }).data.payload.message;
    expect(note).toMatch(/two different app user ids/i);
    expect(note).not.toContain("sub-1");
    expect(note).not.toContain("sub-2");
  });

  it("the same app user id on both customers is not a conflict", async () => {
    const { tx } = fakeTx([{ externalId: "sub-1", clientId: "keep" }, { externalId: "sub-1 ", clientId: "dup" }]);
    expect((await mergeClientRecords(tx, "keep", "dup", "actor", { linkAppIds: true })).appUserIdConflict).toBe(false);
  });

  it("only app-signup rows that reached a customer decide the conflict", async () => {
    const { tx, calls } = fakeTx([]);
    await mergeClientRecords(tx, "keep", "dup", "actor", { linkAppIds: true });
    const find = intakeCalls(calls).find((c) => c.method === "findMany")?.args as { where: Record<string, unknown> };
    expect(find.where.source).toBe("allvest_app");
    expect(find.where.status).toEqual({ in: ["CREATED", "DUPLICATE"] });
  });
});

describe("mergeClientRecords: merge note", () => {
  it("does not put the merged-away customer's name in the note on the survivor", async () => {
    const { tx, calls } = fakeTx([]);
    await mergeClientRecords(tx, "primary", "dup", "actor", { enforcePanGuard: false });
    const note = calls.find((c) => c.model === "activity" && c.method === "create");
    const message = (note?.args as { data: { payload: { message: string } } }).data.payload.message;
    expect(message).not.toContain("Dup");
    expect(message).toContain("C2");
  });
});
