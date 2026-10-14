/**
 * Real-database checks of the experiment store: the schema, the idempotent exposure (unique on experiment and subject),
 * stop behaviour and the summary read. Skipped unless DATABASE_URL is a local scratch database named wt_*. Run it alone:
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55432/wt_persist_scratch npx vitest run src/lib/experiments/store.db.test.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";

import { ExperimentError } from "./model";
import { prismaExperimentPort } from "./store.prisma";
import { createExperimentStore, type ExperimentStore } from "./store";
import { CONVERSION_OUTCOME } from "./summarise";

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.EXPERIMENTS_DB_TEST === "1" && url !== "" && local && /\/wt_[a-z0-9_]+$/.test(url);

const RUN = `dbtest-${Date.now().toString(36)}`;
const ARMS = [
  { key: "control", label: "Current", weight: 50 },
  { key: "variant", label: "New", weight: 50 },
];

describe.skipIf(!enabled)("experiment store (real database)", { timeout: 90_000 }, () => {
  let db: PrismaClient;
  let store: ExperimentStore;

  beforeAll(() => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    store = createExperimentStore(prismaExperimentPort(db));
  });

  afterAll(async () => {
    await db.abExperiment.deleteMany({ where: { key: { startsWith: RUN } } }); // arms, exposures, outcomes cascade
    await db.$disconnect();
  });

  it("creates, starts, assigns 200 subjects once each, and reads the summary", async () => {
    const key = `${RUN}-main`;
    await store.create({ key, name: "DB main", arms: ARMS });
    await store.start(key);

    const arms = new Map<string, string>();
    for (let i = 0; i < 200; i++) arms.set(`subj-${i}`, await store.assign(key, `subj-${i}`));
    // second pass: same answers, no new rows
    for (let i = 0; i < 200; i++) expect(await store.assign(key, `subj-${i}`)).toBe(arms.get(`subj-${i}`));

    const exposures = await db.abExperimentExposure.count({ where: { experiment: { key } } });
    expect(exposures).toBe(200);

    for (let i = 0; i < 200; i += 3) await store.recordOutcome(key, `subj-${i}`, CONVERSION_OUTCOME);
    const s = await store.summary(key);
    expect(s.arms.reduce((n, a) => n + a.exposed, 0)).toBe(200);
    expect(s.duplicateExposures).toBe(0);
  });

  it("unique (experimentId, subjectId): a direct second exposure row is rejected by the database", async () => {
    const key = `${RUN}-unique`;
    await store.create({ key, name: "DB unique", arms: ARMS });
    await store.start(key);
    await store.assign(key, "dup-subject");
    const exp = await db.abExperiment.findUniqueOrThrow({ where: { key } });
    await expect(
      db.abExperimentExposure.create({ data: { experimentId: exp.id, armKey: "variant", subjectId: "dup-subject" } }),
    ).rejects.toThrow();
  });

  it("stop rolls a new subject to control and writes nothing for it", async () => {
    const key = `${RUN}-stop`;
    await store.create({ key, name: "DB stop", arms: ARMS });
    await store.start(key);
    await store.stop(key);
    expect(await store.assign(key, "late-subject")).toBe("control");
    const exp = await db.abExperiment.findUniqueOrThrow({ where: { key } });
    expect(await db.abExperimentExposure.count({ where: { experimentId: exp.id } })).toBe(0);
  });

  it("refuses a duplicate key as ALREADY_EXISTS", async () => {
    const key = `${RUN}-dupkey`;
    await store.create({ key, name: "DB dup", arms: ARMS });
    const err = await store.create({ key, name: "DB dup", arms: ARMS }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExperimentError);
    expect((err as ExperimentError).code).toBe("ALREADY_EXISTS");
  });
});
