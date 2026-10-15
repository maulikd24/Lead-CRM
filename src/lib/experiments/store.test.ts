import { describe, expect, it } from "vitest";

import { ExperimentError, type ExperimentStatus } from "./model";
import { createExperimentStore, type ExperimentDbPort, type StoredExperiment } from "./store";
import { CONVERSION_OUTCOME } from "./summarise";

/** In-memory port. `writes` counts every call that changes state, so tests can assert "nothing was written". */
function fakePort() {
  const experiments = new Map<string, StoredExperiment>();
  const exposures = new Map<string, { experimentId: string; subjectId: string; armKey: string }>();
  const outcomes: { experimentId: string; subjectId: string; armKey: string; outcome: string }[] = [];
  let writes = 0;
  let nextId = 1;

  const port: ExperimentDbPort = {
    async insertExperiment(input) {
      writes += 1;
      const e: StoredExperiment = { id: `exp${nextId++}`, key: input.key, name: input.name, status: "draft", arms: input.arms };
      experiments.set(e.id, e);
      return e;
    },
    async findByKey(key) {
      return [...experiments.values()].find((e) => e.key === key) ?? null;
    },
    async transitionStatus(id, from, to) {
      const e = experiments.get(id);
      if (!e || e.status !== from) return false;
      writes += 1;
      e.status = to as ExperimentStatus;
      return true;
    },
    async findExposure(experimentId, subjectId) {
      return exposures.get(`${experimentId}|${subjectId}`)?.armKey ?? null;
    },
    async insertExposure(experimentId, subjectId, armKey) {
      const k = `${experimentId}|${subjectId}`;
      const existing = exposures.get(k);
      if (existing) return existing.armKey; // unique (experimentId, subjectId): first exposure wins
      writes += 1;
      exposures.set(k, { experimentId, subjectId, armKey });
      return armKey;
    },
    async insertOutcome(experimentId, subjectId, armKey, outcome) {
      writes += 1;
      outcomes.push({ experimentId, subjectId, armKey, outcome });
    },
    async listExposures(experimentId) {
      return [...exposures.values()].filter((x) => x.experimentId === experimentId).map((x) => ({ subjectId: x.subjectId, armKey: x.armKey }));
    },
    async listOutcomes(experimentId) {
      return outcomes.filter((x) => x.experimentId === experimentId).map((x) => ({ subjectId: x.subjectId, type: x.outcome }));
    },
  };
  return { port, experiments, exposures, outcomes, writes: () => writes };
}

const ARMS = [
  { key: "control", label: "Current", weight: 50 },
  { key: "variant", label: "New", weight: 30 },
  { key: "bold", label: "Bold", weight: 20 },
];

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    return err instanceof ExperimentError ? err.code : `not an ExperimentError: ${String(err)}`;
  }
}

describe("experiment store (fake port)", () => {
  it("creates a draft with arms in order, the first arm as control", async () => {
    const f = fakePort();
    const store = createExperimentStore(f.port);
    const e = await store.create({ key: "renewal-msg", name: "Renewal message", arms: ARMS });
    expect(e.status).toBe("draft");
    expect(e.arms.map((a) => [a.key, a.position])).toEqual([["control", 0], ["variant", 1], ["bold", 2]]);
  });

  it("weight-sum guard: weights that do not sum to 100 are refused before any write", async () => {
    const f = fakePort();
    const store = createExperimentStore(f.port);
    const bad = [
      { key: "a", label: "A", weight: 50 },
      { key: "b", label: "B", weight: 30 },
    ];
    expect(await codeOf(store.create({ key: "sum-off", name: "Sum", arms: bad }))).toBe("WEIGHTS_NOT_100");
    expect(f.writes()).toBe(0);
  });

  it("weight-sum guard: start re-checks stored arms and refuses a draft whose weights no longer sum to 100", async () => {
    const f = fakePort();
    const store = createExperimentStore(f.port);
    const e = await store.create({ key: "tampered", name: "Tampered", arms: ARMS });
    e.arms[1].weight = 40; // stored data drifted from the rule
    const writesBefore = f.writes();
    expect(await codeOf(store.start("tampered"))).toBe("WEIGHTS_NOT_100");
    expect(f.experiments.get(e.id)?.status).toBe("draft");
    expect(f.writes()).toBe(writesBefore);
  });

  it("refuses a duplicate key and an unknown key", async () => {
    const f = fakePort();
    const store = createExperimentStore(f.port);
    await store.create({ key: "dup", name: "One", arms: ARMS });
    expect(await codeOf(store.create({ key: "dup", name: "Two", arms: ARMS }))).toBe("ALREADY_EXISTS");
    expect(await codeOf(store.assign("missing", "cust-1"))).toBe("NOT_FOUND");
  });

  it("draft cannot assign: throws DRAFT_CANNOT_ASSIGN and writes no exposure", async () => {
    const f = fakePort();
    const store = createExperimentStore(f.port);
    await store.create({ key: "not-started", name: "Draft", arms: ARMS });
    const before = f.writes();
    expect(await codeOf(store.assign("not-started", "cust-1"))).toBe("DRAFT_CANNOT_ASSIGN");
    expect(f.exposures.size).toBe(0);
    expect(f.writes()).toBe(before);
  });

  it("start moves draft to running once; a second start and a stop of a draft are refused", async () => {
    const f = fakePort();
    const store = createExperimentStore(f.port);
    await store.create({ key: "lifecycle", name: "Life", arms: ARMS });
    expect(await codeOf(store.stop("lifecycle"))).toBe("BAD_STATUS");
    await store.start("lifecycle");
    expect((await store.get("lifecycle")).status).toBe("running");
    expect(await codeOf(store.start("lifecycle"))).toBe("BAD_STATUS");
  });

  it("idempotent exposure: a running subject is stored once and keeps its arm across repeated assigns", async () => {
    const f = fakePort();
    const store = createExperimentStore(f.port);
    await store.create({ key: "idem", name: "Idem", arms: ARMS });
    await store.start("idem");
    const first = await store.assign("idem", "cust-42");
    const writesAfterFirst = f.writes();
    for (let i = 0; i < 5; i++) expect(await store.assign("idem", "cust-42")).toBe(first);
    expect(f.exposures.size).toBe(1);
    expect(f.writes()).toBe(writesAfterFirst); // repeats wrote nothing
  });

  it("stopped returns control for every subject, writes no new exposure, and keeps an old one", async () => {
    const f = fakePort();
    const store = createExperimentStore(f.port);
    await store.create({ key: "halt", name: "Halt", arms: ARMS });
    await store.start("halt");
    // find a subject that lands in a non-control arm while running
    let treated = "";
    for (let i = 0; i < 500 && !treated; i++) {
      const id = `cust-${i}`;
      if ((await store.assign("halt", id)) !== "control") treated = id;
    }
    expect(treated).not.toBe("");
    await store.stop("halt");
    expect(await store.assign("halt", treated)).toBe("control"); // rolled back for an already-exposed subject
    expect(f.exposures.get(`${(await store.get("halt")).id}|${treated}`)?.armKey).not.toBe("control"); // history kept
    const writesBefore = f.writes();
    expect(await store.assign("halt", "brand-new-subject")).toBe("control");
    expect(f.writes()).toBe(writesBefore); // nothing written for a new subject after stop
  });

  it("outcomes: only exposed subjects can record one, under the arm they were exposed to", async () => {
    const f = fakePort();
    const store = createExperimentStore(f.port);
    await store.create({ key: "outc", name: "Outc", arms: ARMS });
    await store.start("outc");
    const arm = await store.assign("outc", "cust-7");
    expect(await codeOf(store.recordOutcome("outc", "cust-unseen", CONVERSION_OUTCOME))).toBe("NOT_EXPOSED");
    await store.recordOutcome("outc", "cust-7", CONVERSION_OUTCOME);
    expect(f.outcomes).toHaveLength(1);
    expect(f.outcomes[0].armKey).toBe(arm);
    expect(await codeOf(store.recordOutcome("outc", "cust-7", "  "))).toBe("BAD_OUTCOME");
  });

  it("privacy backstop: a contact-looking subject id is refused on assign and on outcome", async () => {
    const f = fakePort();
    const store = createExperimentStore(f.port);
    await store.create({ key: "pii", name: "Pii", arms: ARMS });
    await store.start("pii");
    expect(await codeOf(store.assign("pii", "asha@example.com"))).toBe("BAD_SUBJECT");
    expect(await codeOf(store.assign("pii", "Asha Rao"))).toBe("BAD_SUBJECT");
    expect(await codeOf(store.recordOutcome("pii", "+91 98765 43210", CONVERSION_OUTCOME))).toBe("BAD_SUBJECT");
    expect(f.exposures.size).toBe(0);
  });

  it("summary runs the pure summarise over stored exposures and outcomes", async () => {
    const f = fakePort();
    const store = createExperimentStore(f.port);
    await store.create({ key: "read", name: "Read", arms: ARMS });
    await store.start("read");
    for (let i = 0; i < 400; i++) {
      const subject = `s-${i}`;
      const arm = await store.assign("read", subject);
      if (arm === "variant" || i % 4 === 0) await store.recordOutcome("read", subject, CONVERSION_OUTCOME);
    }
    const s = await store.summary("read");
    expect(s.control).toBe("control");
    expect(s.arms.map((a) => a.armKey)).toEqual(["control", "variant", "bold"]);
    const total = s.arms.reduce((n, a) => n + a.exposed, 0);
    expect(total).toBe(400);
    expect(s.comparisons).toHaveLength(2);
    expect(s.verdict.length).toBeGreaterThan(0);
  });

  it("the stored status is one of draft, running, stopped", async () => {
    const f = fakePort();
    const store = createExperimentStore(f.port);
    await store.create({ key: "states", name: "States", arms: ARMS });
    await store.start("states");
    await store.stop("states");
    expect((await store.get("states")).status).toBe("stopped");
  });
});
