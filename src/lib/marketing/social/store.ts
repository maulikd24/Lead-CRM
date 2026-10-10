import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

import { getSocialPublisher } from "./publisher";
import { createSocialService, type PostRow, type PostStore } from "./service";

const asRow = (row: { status: string; source: string } & Record<string, unknown>) => row as unknown as PostRow;

export const prismaPostStore: PostStore = {
  async get(id) {
    const row = await prisma.socialPost.findUnique({ where: { id } });
    return row ? asRow(row) : null;
  },
  async insert(data) {
    return asRow(await prisma.socialPost.create({ data: { ...data, complianceIssues: (data.complianceIssues ?? undefined) as Prisma.InputJsonValue | undefined } }));
  },
  async casUpdate(id, expected, data) {
    const { complianceIssues, ...rest } = data;
    const res = await prisma.socialPost.updateMany({ where: { id, status: expected }, data: { ...rest, ...(complianceIssues !== undefined ? { complianceIssues: complianceIssues as Prisma.InputJsonValue } : {}) } });
    return res.count === 1;
  },
  async remove(id) {
    await prisma.socialPost.delete({ where: { id } });
  },
  async addEvent(event) {
    await prisma.socialPostEvent.create({ data: event });
  },
  async list(filter) {
    return (await prisma.socialPost.findMany({ where: filter?.status ? { status: filter.status } : undefined, orderBy: { createdAt: "desc" }, take: 500 })).map(asRow);
  },
};

export const socialService = () => createSocialService({ store: prismaPostStore, publisher: getSocialPublisher(), now: () => new Date() });
