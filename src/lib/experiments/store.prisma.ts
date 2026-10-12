/**
 * Prisma implementation of ExperimentDbPort. Only storage calls here; rules live in store.ts.
 */
import { Prisma, type PrismaClient } from "@/generated/prisma/client";

import { ExperimentError, type ExperimentStatus } from "./model";
import type { ExperimentDbPort, StoredArm, StoredExperiment } from "./store";

type ExperimentRow = {
  id: string;
  key: string;
  name: string;
  status: string;
  arms: { key: string; label: string; weight: number; position: number }[];
};

function toStored(row: ExperimentRow): StoredExperiment {
  const arms: StoredArm[] = [...row.arms]
    .sort((a, b) => a.position - b.position)
    .map((a) => ({ key: a.key, label: a.label, weight: a.weight, position: a.position }));
  return { id: row.id, key: row.key, name: row.name, status: row.status as ExperimentStatus, arms };
}

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

export function prismaExperimentPort(db: PrismaClient): ExperimentDbPort {
  return {
    async insertExperiment(input) {
      try {
        const row = await db.abExperiment.create({
          data: {
            key: input.key,
            name: input.name,
            status: "draft",
            arms: { create: input.arms.map((a) => ({ key: a.key, label: a.label, weight: a.weight, position: a.position })) },
          },
          include: { arms: true },
        });
        return toStored(row);
      } catch (err) {
        if (isUniqueViolation(err)) throw new ExperimentError("ALREADY_EXISTS", `An experiment with key "${input.key}" already exists.`);
        throw err;
      }
    },

    async findByKey(key) {
      const row = await db.abExperiment.findUnique({ where: { key }, include: { arms: true } });
      return row ? toStored(row) : null;
    },

    async transitionStatus(experimentId, from, to) {
      const res = await db.abExperiment.updateMany({ where: { id: experimentId, status: from }, data: { status: to } });
      return res.count === 1;
    },

    async findExposure(experimentId, subjectId) {
      const row = await db.abExperimentExposure.findUnique({
        where: { experimentId_subjectId: { experimentId, subjectId } },
        select: { armKey: true },
      });
      return row?.armKey ?? null;
    },

    async insertExposure(experimentId, subjectId, armKey) {
      // skipDuplicates makes a concurrent second insert a no-op; the read after it returns whichever arm was stored first.
      await db.abExperimentExposure.createMany({ data: [{ experimentId, subjectId, armKey }], skipDuplicates: true });
      const row = await db.abExperimentExposure.findUniqueOrThrow({
        where: { experimentId_subjectId: { experimentId, subjectId } },
        select: { armKey: true },
      });
      return row.armKey;
    },

    async insertOutcome(experimentId, subjectId, armKey, outcome) {
      await db.abExperimentOutcome.create({ data: { experimentId, subjectId, armKey, outcome } });
    },

    async listExposures(experimentId) {
      const rows = await db.abExperimentExposure.findMany({ where: { experimentId }, select: { subjectId: true, armKey: true } });
      return rows;
    },

    async listOutcomes(experimentId) {
      const rows = await db.abExperimentOutcome.findMany({ where: { experimentId }, select: { subjectId: true, outcome: true } });
      return rows.map((r) => ({ subjectId: r.subjectId, type: r.outcome }));
    },
  };
}
