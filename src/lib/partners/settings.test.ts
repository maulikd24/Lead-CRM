import { describe, expect, it, vi } from "vitest";

import { brandingOf, buildReferralLink, DEFAULT_LAPSE_DAYS, loadWorkspaceSettings, readSettings, saveWorkspaceSetting, validateSetting, type SettingsDb } from "./settings";

describe("validateSetting: letterhead", () => {
  it("keeps non-empty trimmed lines, at most six, each short", () => {
    const r = validateSetting("letterhead", { lines: [" Firm name ", "", "Address line 1", "  "] });
    expect(r).toEqual({ ok: true, value: { lines: ["Firm name", "Address line 1"] } });
  });
  it("refuses too many or too long lines", () => {
    expect(validateSetting("letterhead", { lines: Array.from({ length: 7 }, (_, i) => `l${i}`) }).ok).toBe(false);
    expect(validateSetting("letterhead", { lines: ["x".repeat(121)] }).ok).toBe(false);
  });
  it("an empty letterhead is allowed: the statement then prints without one", () => {
    expect(validateSetting("letterhead", { lines: [] })).toEqual({ ok: true, value: { lines: [] } });
  });
});

describe("validateSetting: registration text", () => {
  it("is trimmed text, up to 400 characters", () => {
    expect(validateSetting("registration", { text: "  Registered with X, no. 123  " })).toEqual({ ok: true, value: { text: "Registered with X, no. 123" } });
    expect(validateSetting("registration", { text: "x".repeat(401) }).ok).toBe(false);
  });
});

describe("validateSetting: referral link and lapse window", () => {
  it("needs a whole number of days from 1 to 730", () => {
    for (const bad of ["0", "731", "1.5", "abc", ""]) expect(validateSetting("referral", { linkBase: "", lapseDays: bad }).ok, bad).toBe(false);
    expect(validateSetting("referral", { linkBase: "", lapseDays: "90" })).toEqual({ ok: true, value: { linkBase: null, lapseDays: 90 } });
  });
  it("the link base must be an https address without credentials, a query or a fragment", () => {
    const base = { lapseDays: "90" };
    expect(validateSetting("referral", { ...base, linkBase: "https://forms.example.test/join" })).toEqual({ ok: true, value: { linkBase: "https://forms.example.test/join", lapseDays: 90 } });
    for (const bad of ["http://forms.example.test", "ftp://x.test", "https://u:p@x.test/", "https://x.test/?a=1", "https://x.test/#f", "javascript:alert(1)", "not a url"]) expect(validateSetting("referral", { ...base, linkBase: bad }).ok, bad).toBe(false);
  });
});

describe("validateSetting: statement queries", () => {
  it("takes a user id or nothing", () => {
    expect(validateSetting("queries", { assigneeUserId: " u1 " })).toEqual({ ok: true, value: { assigneeUserId: "u1" } });
    expect(validateSetting("queries", { assigneeUserId: "" })).toEqual({ ok: true, value: { assigneeUserId: null } });
  });
  it("rejects an unknown key", () => {
    expect(validateSetting("nope", {}).ok).toBe(false);
  });
});

describe("readSettings: defaults only where a default is harmless", () => {
  it("has an empty letterhead, no registration text, no link and a 90 day window when nothing is saved", () => {
    expect(readSettings([])).toEqual({ letterhead: { lines: [] }, registration: { text: "" }, referral: { linkBase: null, lapseDays: DEFAULT_LAPSE_DAYS }, queries: { assigneeUserId: null } });
    expect(DEFAULT_LAPSE_DAYS).toBe(90);
  });
  it("uses saved values and ignores a malformed saved row", () => {
    const s = readSettings([
      { key: "letterhead", value: { lines: ["Firm"] } },
      { key: "referral", value: { linkBase: "https://x.test/j", lapseDays: 30 } },
      { key: "registration", value: { text: 42 } },
    ]);
    expect(s.letterhead.lines).toEqual(["Firm"]);
    expect(s.referral).toEqual({ linkBase: "https://x.test/j", lapseDays: 30 });
    expect(s.registration.text).toBe("");
  });
});

describe("buildReferralLink", () => {
  it("adds the partner code as the ref parameter", () => {
    expect(buildReferralLink("https://forms.example.test/join", "PTR-00001")).toBe("https://forms.example.test/join?ref=PTR-00001");
  });
  it("is null without a base or with a malformed code", () => {
    expect(buildReferralLink(null, "PTR-00001")).toBeNull();
    expect(buildReferralLink("https://x.test/j", "bad code&x=1")).toBeNull();
  });
});

describe("saving", () => {
  const rows: { key: string; value: unknown }[] = [];
  const audits: Record<string, unknown>[] = [];
  const db = {
    partnerWorkspaceSetting: {
      findMany: vi.fn(async () => rows),
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => rows.find((r) => r.key === where.key) ?? null),
      upsert: vi.fn(async ({ where, create }: { where: { key: string }; create: { key: string; value: unknown } }) => {
        const i = rows.findIndex((r) => r.key === where.key);
        if (i >= 0) rows[i] = create;
        else rows.push(create);
      }),
    },
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => audits.push(data)) },
  } as unknown as SettingsDb;

  it("stores a valid value and audits who changed what, with old and new", async () => {
    const r = await saveWorkspaceSetting(db, { id: "u-fin" }, "letterhead", { lines: ["Firm"] });
    expect(r).toEqual({ ok: true });
    expect((await loadWorkspaceSettings(db)).letterhead.lines).toEqual(["Firm"]);
    await saveWorkspaceSetting(db, { id: "u-fin" }, "letterhead", { lines: ["Firm", "Town"] });
    expect(audits.at(-1)).toMatchObject({ userId: "u-fin", entity: "PartnerWorkspaceSetting", entityId: "letterhead", action: "partner_setting_changed", oldValue: { lines: ["Firm"] }, newValue: { lines: ["Firm", "Town"] } });
  });
  it("stores nothing and audits nothing for an invalid value", async () => {
    const n = audits.length;
    const r = await saveWorkspaceSetting(db, { id: "u-fin" }, "referral", { linkBase: "http://x.test", lapseDays: "90" });
    expect(r.ok).toBe(false);
    expect(audits.length).toBe(n);
  });
});

describe("brandingOf", () => {
  it("is the letterhead lines and the registration text, for statements", () => {
    expect(brandingOf(readSettings([{ key: "letterhead", value: { lines: ["Firm"] } }, { key: "registration", value: { text: "Reg 1" } }]))).toEqual({ letterhead: ["Firm"], registration: "Reg 1" });
    expect(brandingOf(readSettings([]))).toEqual({ letterhead: [], registration: "" });
  });
});
