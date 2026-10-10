import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

import type { AdminStore } from "./admin";
import type { RuleValue } from "./rewards";

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const ruleData = (v: RuleValue) => ({ name: v.name, event: v.event, kind: v.kind, fixedPaise: v.fixedPaise, percentBps: v.percentBps, maxRewardPaise: v.maxRewardPaise, capPerReferrerMonthPaise: v.capPerReferrerMonthPaise, validFrom: v.validFrom, validTo: v.validTo });

export const prismaAdminStore: AdminStore = {
  async findClientByCode(clientCode) {
    return prisma.client.findUnique({ where: { clientCode }, select: { id: true, name: true, status: true, mergedIntoId: true, isDeleted: true } });
  },
  async createReferrerWithCode({ clientId, createdById, code }) {
    if (await prisma.referrer.findUnique({ where: { clientId }, select: { id: true } })) return "exists";
    try {
      const r = await prisma.referrer.create({ data: { clientId, createdById, codes: { create: { code } } }, select: { id: true } });
      return { referrerId: r.id };
    } catch (e) {
      if (!isUnique(e)) throw e;
      return (await prisma.referralCode.findUnique({ where: { code }, select: { id: true } })) ? "code_taken" : "exists";
    }
  },
  async getReferrerStatus(id) {
    return ((await prisma.referrer.findUnique({ where: { id }, select: { status: true } }))?.status as "ACTIVE" | "SUSPENDED" | undefined) ?? null;
  },
  async addCode(referrerId, code) {
    try {
      await prisma.referralCode.create({ data: { referrerId, code } });
      return "ok";
    } catch (e) {
      if (isUnique(e)) return "code_taken";
      throw e;
    }
  },
  async revokeCode(codeId, by, reason) {
    const r = await prisma.referralCode.updateMany({ where: { id: codeId, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: new Date(), revokedById: by, revokeReason: reason } });
    return r.count === 1;
  },
  async setReferrerStatus(id, status) {
    return (await prisma.referrer.updateMany({ where: { id }, data: { status } })).count === 1;
  },
  async createRule(v, active, by) {
    return (await prisma.rewardRule.create({ data: { ...ruleData(v), active, createdById: by }, select: { id: true } })).id;
  },
  async updateRule(id, v, active, by) {
    return (await prisma.rewardRule.updateMany({ where: { id }, data: { ...ruleData(v), ...(active === undefined ? {} : { active }), updatedById: by } })).count === 1;
  },
  async getRule(id) {
    return prisma.rewardRule.findUnique({ where: { id }, select: { active: true, validFrom: true } });
  },
  async setRuleActive(id, active, validFrom, by) {
    return (await prisma.rewardRule.updateMany({ where: { id }, data: { active, validFrom, updatedById: by } })).count === 1;
  },
  async getSetting(key) {
    return (await prisma.referralSetting.findUnique({ where: { key } }))?.value ?? null;
  },
  async saveSetting(key, value, by) {
    await prisma.referralSetting.upsert({ where: { key }, create: { key, value, updatedById: by }, update: { value, updatedById: by } });
  },
};
