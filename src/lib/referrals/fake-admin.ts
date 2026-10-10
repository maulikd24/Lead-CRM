import type { AdminStore } from "./admin";
import type { RuleValue } from "./rewards";

type Rule = RuleValue & { id: string; active: boolean };

/** In-memory AdminStore for tests. */
export class FakeAdmin implements AdminStore {
  clients = new Map<string, { id: string; name: string; status: string; mergedIntoId: string | null; isDeleted: boolean }>();
  referrers: { id: string; clientId: string; status: "ACTIVE" | "SUSPENDED" }[] = [];
  codes: { id: string; referrerId: string; code: string; status: "ACTIVE" | "REVOKED"; revokeReason?: string }[] = [];
  takenCodes = new Set<string>();
  rules: Rule[] = [];
  settings = new Map<string, string>();
  private n = 0;

  async findClientByCode(c: string) {
    return this.clients.get(c) ?? null;
  }
  async createReferrerWithCode(i: { clientId: string; createdById: string; code: string }) {
    if (this.referrers.some((r) => r.clientId === i.clientId)) return "exists" as const;
    if (this.takenCodes.has(i.code) || this.codes.some((c) => c.code === i.code)) return "code_taken" as const;
    const id = `rr${++this.n}`;
    this.referrers.push({ id, clientId: i.clientId, status: "ACTIVE" });
    this.codes.push({ id: `cd${++this.n}`, referrerId: id, code: i.code, status: "ACTIVE" });
    return { referrerId: id };
  }
  async getReferrerStatus(id: string) {
    return this.referrers.find((r) => r.id === id)?.status ?? null;
  }
  async addCode(referrerId: string, code: string) {
    if (this.takenCodes.has(code) || this.codes.some((c) => c.code === code)) return "code_taken" as const;
    this.codes.push({ id: `cd${++this.n}`, referrerId, code, status: "ACTIVE" });
    return "ok" as const;
  }
  async revokeCode(codeId: string, _by: string, reason: string) {
    const c = this.codes.find((x) => x.id === codeId);
    if (!c || c.status === "REVOKED") return false;
    Object.assign(c, { status: "REVOKED", revokeReason: reason });
    return true;
  }
  async setReferrerStatus(id: string, status: "ACTIVE" | "SUSPENDED") {
    const r = this.referrers.find((x) => x.id === id);
    if (!r) return false;
    r.status = status;
    return true;
  }
  async createRule(v: RuleValue, active: boolean) {
    const id = `ru${++this.n}`;
    this.rules.push({ ...v, id, active });
    return id;
  }
  async updateRule(id: string, v: RuleValue, active: boolean | undefined) {
    const r = this.rules.find((x) => x.id === id);
    if (!r) return false;
    Object.assign(r, v, active === undefined ? {} : { active });
    return true;
  }
  async getRule(id: string) {
    return this.rules.find((x) => x.id === id) ?? null;
  }
  async setRuleActive(id: string, active: boolean, validFrom: Date | null) {
    const r = this.rules.find((x) => x.id === id);
    if (!r) return false;
    Object.assign(r, { active, validFrom });
    return true;
  }
  async getSetting(key: string) {
    return this.settings.get(key) ?? null;
  }
  async saveSetting(key: string, value: string) {
    this.settings.set(key, value);
  }
}
