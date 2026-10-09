import {
  refereePageSchema,
  referrerDetailSchema,
  referrerPageSchema,
  summarySchema,
  withdrawalPageSchema,
} from "./schemas";
import { ReferralApiError, DEFAULT_PAGE_SIZE, type ReferralApiPort } from "./referral-api";

/**
 * Synthetic data behind the "mock" mode of the referral API connection: no network, no real people.
 * Names are made-up combinations, mobile numbers use an unassigned-looking block, there is no PAN,
 * e-mail or bank detail anywhere. Everything is generated from a seed, so it is repeatable.
 */

type Raw = Record<string, unknown>;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Asha", "Ravi", "Meera", "Kabir", "Isha", "Dev", "Nisha", "Arjun", "Tara", "Vikram", "Anya", "Rohan", "Sana", "Karan", "Leela", "Neel", "Pooja", "Yash", "Zoya", "Omar"];
const LAST = ["Verma", "Iyer", "Kulkarni", "Bose", "Menon", "Shah", "Reddy", "Nair", "Gill", "Das", "Rao", "Sethi", "Pillai", "Joshi"];
const KYC_POOL = ["Accepted", "Accepted", "Accepted", "Accepted", "Pending", "Pending Verification", "Initiated", "ReKYC", "Rejected", "Blocked", "InActive"];
const FUNNEL = ["SIGNED_UP", "KYC_IN_PROGRESS", "ACCOUNT_OPENED", "ACCOUNT_OPENED", "ACTIVE", "ACTIVE", "DORMANT", "REJECTED"];
const WD_STATUS = ["REQUESTED", "APPROVED", "PAID", "PAID", "PAID", "REJECTED", "CANCELLED", "FAILED"];
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const GROUPS: Record<string, string[]> = {
  verified: ["accepted", "approved", "verified"],
  pending: ["pending", "pendingverification", "initiated", "inactive"],
  needs_info: ["rekyc", "needinfo"],
  rejected: ["rejected", "blocked"],
};
const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

/** Does a KYC status string belong to a filter group (verified, pending, needs_info, rejected)? Unknown groups match an exact status. */
export function kycGroupMatches(group: string, status: string | null): boolean {
  if (!status) return false;
  const g = GROUPS[group];
  return g ? g.includes(norm(status)) : norm(status) === norm(group);
}

export function syntheticReferralData(seed = 7) {
  const r = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const day = (back: number) => new Date(Date.UTC(2026, 9, 1) - back * 86400000).toISOString();

  const used = new Set<string>();
  const referrers: Raw[] = Array.from({ length: 48 }, (_, i) => {
    const kyc = pick(KYC_POOL);
    const k = norm(kyc);
    const status = k === "accepted" ? (r() < 0.85 ? "ACTIVE" : r() < 0.5 ? "AGREEMENT_PENDING" : "SUSPENDED") : k === "blocked" || k === "rejected" ? (r() < 0.5 ? "TERMINATED" : "SUSPENDED") : "ELIGIBILITY_PENDING";
    let code = "";
    do code = "REF_" + Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(r() * CODE_CHARS.length)]).join("");
    while (used.has(code));
    used.add(code);
    const active = status === "ACTIVE";
    return {
      id: String(100 + i),
      fullName: `${pick(FIRST)} ${pick(LAST)}`,
      referrerType: r() < 0.7 ? "PLATFORM_CLIENT" : "EXTERNAL",
      status,
      kycStatus: kyc,
      referralCode: status === "ELIGIBILITY_PENDING" ? null : code,
      mobile: `+919000${String(Math.floor(r() * 1e6)).padStart(6, "0")}`,
      clientCode: r() < 0.8 ? `SYN${String(1000 + i)}` : null,
      refereeCount: 0,
      earningsTotal: active ? Math.round(r() * 90000) / 10 + 100 : 0,
      enrolledAt: day(40 + Math.floor(r() * 200)),
      activatedAt: active ? day(10 + Math.floor(r() * 30)) : null,
      suspensionReason: status === "SUSPENDED" ? (r() < 0.6 ? "KYC_LAPSED" : "ADMIN") : null,
    };
  });

  const eligible = referrers.filter((x) => x.referralCode);
  const referees: Raw[] = Array.from({ length: 180 }, (_, i) => {
    const owner = pick(eligible);
    owner.refereeCount = Number(owner.refereeCount) + 1;
    const funnel = pick(FUNNEL);
    const opened = funnel === "ACCOUNT_OPENED" || funnel === "ACTIVE" || funnel === "DORMANT";
    return {
      id: String(5000 + i),
      displayName: `${pick(FIRST).slice(0, 1)}. ${pick(LAST).slice(0, 1)}.`,
      referrerId: owner.id,
      referrerName: owner.fullName,
      attributionStatus: "ATTRIBUTED",
      funnelStatus: funnel,
      signupChannel: pick(["EMAIL", "GOOGLE", "APPLE"]),
      kycStatus: funnel === "REJECTED" ? "Rejected" : opened ? "Accepted" : pick(["Pending", "Initiated", "Pending Verification"]),
      clientCode: opened ? `SYN${String(5000 + i)}` : null,
      signedUpAt: day(Math.floor(r() * 120)),
      accountOpenedAt: opened ? day(Math.floor(r() * 60)) : null,
      lastBrokerageDate: funnel === "ACTIVE" ? day(Math.floor(r() * 20)) : null,
    };
  });

  const withdrawals: Raw[] = Array.from({ length: 30 }, (_, i) => {
    const owner = pick(referrers.filter((x) => x.status === "ACTIVE"));
    const status = pick(WD_STATUS);
    const amount = 500 + Math.floor(r() * 9500);
    const paid = status === "PAID";
    const tds = paid ? Math.round(amount * 0.1) : null;
    return {
      id: String(900 + i),
      withdrawalRef: `WD-${String(2026000 + i)}`,
      referrerId: owner.id,
      referrerName: owner.fullName,
      requestType: "USER_REQUESTED",
      status,
      amount,
      tdsAmount: tds,
      netAmount: tds === null ? null : amount - tds,
      requestedAt: day(2 + Math.floor(r() * 60)),
      decidedAt: status === "REQUESTED" ? null : day(1 + Math.floor(r() * 5)),
      paidAt: paid ? day(Math.floor(r() * 3)) : null,
    };
  });

  const months = ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  let level = 40000;
  const monthly = months.map((period) => {
    level = Math.round(level * (0.95 + r() * 0.35));
    return { period, earnings: level, referees: 15 + Math.floor(r() * 40) };
  });

  return { referrers, referees, withdrawals, monthly };
}

type Data = ReturnType<typeof syntheticReferralData>;

function page<T>(rows: T[], f: { limit?: number; offset?: number }) {
  const limit = Math.min(100, Math.max(1, f.limit ?? DEFAULT_PAGE_SIZE));
  const offset = Math.max(0, f.offset ?? 0);
  return { items: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
}

/** Same interface as the live client, answering from synthetic data. Responses go through the same Zod schemas. */
export function createMockReferralApi(seed = 7): ReferralApiPort {
  const d: Data = syntheticReferralData(seed);
  const byEarnings = [...d.referrers].sort((a, b) => Number(b.earningsTotal) - Number(a.earningsTotal));

  return {
    async getSummary() {
      const rs = d.referrers;
      const count = (s: string) => rs.filter((x) => x.status === s).length;
      const last = d.monthly[d.monthly.length - 1];
      return summarySchema.parse({
        referrers: { total: rs.length, active: count("ACTIVE"), pending: count("ELIGIBILITY_PENDING") + count("AGREEMENT_PENDING"), suspended: count("SUSPENDED"), terminated: count("TERMINATED") },
        referees: { total: d.referees.length, active: d.referees.filter((x) => x.funnelStatus === "ACTIVE").length },
        earnings: { lastMonth: last.earnings, lastMonthLabel: "Sep 2026", total: d.monthly.reduce((a, m) => a + m.earnings, 0) },
        monthly: d.monthly,
        topReferrers: byEarnings.slice(0, 5),
      });
    },
    async listReferrers(f) {
      const q = f.search?.trim().toLowerCase();
      const rows = byEarnings.filter(
        (x) =>
          (!f.status || x.status === f.status) &&
          (!f.kycStatus || kycGroupMatches(f.kycStatus, x.kycStatus as string)) &&
          (!q || String(x.fullName).toLowerCase().includes(q) || String(x.referralCode ?? "").toLowerCase().includes(q)),
      );
      return referrerPageSchema.parse(page(rows, f));
    },
    async getReferrer(id) {
      const row = d.referrers.find((x) => x.id === id);
      if (!row) throw new ReferralApiError("not_found", 404);
      const wds = d.withdrawals.filter((w) => w.referrerId === id);
      const paid = wds.filter((w) => w.status === "PAID");
      return referrerDetailSchema.parse({
        ...row,
        wallet: { available: Math.round(Number(row.earningsTotal) * 0.4), onHold: wds.some((w) => w.status === "REQUESTED") ? 500 : 0 },
        payouts: { requested: wds.filter((w) => w.status === "REQUESTED" || w.status === "APPROVED").length, paid: paid.length, paidTotal: paid.reduce((a, w) => a + Number(w.amount), 0), lastPaidAt: (paid[0]?.paidAt as string) ?? null },
        activity: [
          { at: row.enrolledAt, action: "REFERRER_ENROLLED", label: "Enrolled in the programme" },
          ...(row.activatedAt ? [{ at: row.activatedAt, action: "REFERRER_STATUS_CHANGE", label: "Activated" }] : []),
        ],
      });
    },
    async listReferees(f) {
      const q = f.search?.trim().toLowerCase();
      const rows = d.referees.filter(
        (x) => (!f.referrerId || x.referrerId === f.referrerId) && (!f.funnelStatus || x.funnelStatus === f.funnelStatus) && (!q || String(x.referrerName).toLowerCase().includes(q)),
      );
      return refereePageSchema.parse(page(rows, f));
    },
    async listWithdrawals(f) {
      const rows = d.withdrawals.filter((x) => (!f.status || x.status === f.status) && (!f.referrerId || x.referrerId === f.referrerId));
      const byStatus: Record<string, { count: number; amount: number }> = {};
      for (const w of d.withdrawals) {
        const t = (byStatus[String(w.status)] ??= { count: 0, amount: 0 });
        t.count += 1;
        t.amount += Number(w.amount);
      }
      return withdrawalPageSchema.parse({ ...page(rows, f), summary: { byStatus } });
    },
    async ping() {
      return { ok: true };
    },
  };
}
