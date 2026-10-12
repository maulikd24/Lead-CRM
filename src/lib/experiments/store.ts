/**
 * Persistence for assignment experiments. Thin on purpose: every rule (weights sum to 100, draft cannot assign, stopped
 * returns control, first exposure wins) comes from the pure modules (assign, summarise, model). This file only loads,
 * saves and orders the calls.
 *
 * Storage is behind ExperimentDbPort so the logic is unit-tested with an in-memory fake (no network). The Prisma
 * implementation lives in store.prisma.ts.
 *
 * Privacy: subjectId must be an opaque id or hash. assertOpaqueSubject rejects obvious contact data (an "@", whitespace,
 * overlong values) as a backstop. Callers are still responsible for passing opaque ids.
 *
 * Control arm: the first arm created is the control (position 0). Arms cannot be reordered after creation.
 */
import { assign } from "./assign";
import { type Arm, type ExperimentStatus, ExperimentError, validateArms } from "./model";
import { type Exposure, type Outcome, type Summary, summarise } from "./summarise";

export type StoredArm = { key: string; label: string; weight: number; position: number };

export type StoredExperiment = {
  id: string;
  key: string;
  name: string;
  status: ExperimentStatus;
  /** Sorted by position. arms[0] is the control. */
  arms: StoredArm[];
};

export type NewArm = { key: string; label: string; weight: number };

export interface ExperimentDbPort {
  /** Inserts a draft with its arms. Throws ExperimentError ALREADY_EXISTS when the key is taken. */
  insertExperiment(input: { key: string; name: string; arms: StoredArm[] }): Promise<StoredExperiment>;
  findByKey(key: string): Promise<StoredExperiment | null>;
  /** Moves the experiment from one status to another only if it is still in `from`. Returns false when it was not. */
  transitionStatus(experimentId: string, from: ExperimentStatus, to: ExperimentStatus): Promise<boolean>;
  /** The arm key this subject was first exposed to, or null. */
  findExposure(experimentId: string, subjectId: string): Promise<string | null>;
  /**
   * Records the exposure if none exists, and returns the arm key that is stored for the subject. Idempotent: when an
   * exposure already exists its arm wins and armKey is ignored.
   */
  insertExposure(experimentId: string, subjectId: string, armKey: string): Promise<string>;
  insertOutcome(experimentId: string, subjectId: string, armKey: string, outcome: string): Promise<void>;
  listExposures(experimentId: string): Promise<Exposure[]>;
  listOutcomes(experimentId: string): Promise<Outcome[]>;
}

const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_SUBJECT_LENGTH = 128;
const MAX_OUTCOME_LENGTH = 128;

/** Rejects values that look like contact data. Opaque ids and hashes pass. */
export function assertOpaqueSubject(subjectId: unknown): asserts subjectId is string {
  if (typeof subjectId !== "string" || subjectId.trim() === "") {
    throw new ExperimentError("BAD_SUBJECT", "A subject id is required.");
  }
  if (subjectId.length > MAX_SUBJECT_LENGTH || /[@\s]/.test(subjectId)) {
    throw new ExperimentError("BAD_SUBJECT", "A subject id must be an opaque id or hash, not a name, email or phone.");
  }
}

function assertKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) {
    throw new ExperimentError("BAD_KEY", "An experiment key is 1-64 characters: lowercase letters, digits, dot, dash or underscore.");
  }
}

export function createExperimentStore(db: ExperimentDbPort) {
  async function load(key: string): Promise<StoredExperiment> {
    assertKey(key);
    const experiment = await db.findByKey(key);
    if (!experiment) throw new ExperimentError("NOT_FOUND", `No experiment with key "${key}".`);
    return experiment;
  }

  const pureArms = (e: StoredExperiment): Arm[] => e.arms.map((a) => ({ key: a.key, weight: a.weight }));
  const controlOf = (e: StoredExperiment): string => e.arms[0].key;

  return {
    /** Creates a draft. The first arm is the control. Weights must sum to 100. */
    async create(input: { key: string; name: string; arms: readonly NewArm[] }): Promise<StoredExperiment> {
      assertKey(input.key);
      if (typeof input.name !== "string" || input.name.trim() === "") {
        throw new ExperimentError("BAD_ARMS", "An experiment needs a name.");
      }
      const arms = input.arms.map((a) => ({ key: a.key, weight: a.weight }));
      validateArms(arms); // throws WEIGHTS_NOT_100, BAD_ARMS before any write
      const existing = await db.findByKey(input.key);
      if (existing) throw new ExperimentError("ALREADY_EXISTS", `An experiment with key "${input.key}" already exists.`);
      return db.insertExperiment({
        key: input.key,
        name: input.name.trim(),
        arms: input.arms.map((a, position) => ({ key: a.key, label: a.label, weight: a.weight, position })),
      });
    },

    async get(key: string): Promise<StoredExperiment> {
      return load(key);
    },

    /** draft -> running. Re-checks the arm weights against what is stored before it moves. */
    async start(key: string): Promise<void> {
      const e = await load(key);
      if (e.status !== "draft") throw new ExperimentError("BAD_STATUS", `Only a draft can be started (it is ${e.status}).`);
      validateArms(pureArms(e), controlOf(e));
      const moved = await db.transitionStatus(e.id, "draft", "running");
      if (!moved) throw new ExperimentError("BAD_STATUS", "The experiment changed while starting. Reload and try again.");
    },

    /** running -> stopped. After this, assign returns control for everyone. */
    async stop(key: string): Promise<void> {
      const e = await load(key);
      if (e.status !== "running") throw new ExperimentError("BAD_STATUS", `Only a running experiment can be stopped (it is ${e.status}).`);
      const moved = await db.transitionStatus(e.id, "running", "stopped");
      if (!moved) throw new ExperimentError("BAD_STATUS", "The experiment changed while stopping. Reload and try again.");
    },

    /**
     * Returns the arm for a subject.
     * - draft: throws DRAFT_CANNOT_ASSIGN (from the pure assign), nothing is written.
     * - running: picks the arm with the pure assign and stores the exposure once. A later call returns the stored arm.
     * - stopped: returns control. No new exposure is written, and an existing exposure is left as it was.
     */
    async assign(key: string, subjectId: string): Promise<string> {
      assertOpaqueSubject(subjectId);
      const e = await load(key);
      const armKey = assign(e.key, subjectId, pureArms(e), { status: e.status, control: controlOf(e) });
      if (e.status !== "running") return armKey; // stopped: control, nothing written
      return db.insertExposure(e.id, subjectId, armKey);
    },

    /** Records an outcome for an exposed subject, under the arm they were exposed to. */
    async recordOutcome(key: string, subjectId: string, outcome: string): Promise<void> {
      assertOpaqueSubject(subjectId);
      if (typeof outcome !== "string" || outcome.trim() === "" || outcome.length > MAX_OUTCOME_LENGTH) {
        throw new ExperimentError("BAD_OUTCOME", "An outcome is a non-empty event type, up to 128 characters.");
      }
      const e = await load(key);
      const armKey = await db.findExposure(e.id, subjectId);
      if (armKey === null) throw new ExperimentError("NOT_EXPOSED", "Only an exposed subject can record an outcome.");
      await db.insertOutcome(e.id, subjectId, armKey, outcome);
    },

    /** Reads the stored exposures and outcomes through the pure summarise. */
    async summary(key: string): Promise<Summary> {
      const e = await load(key);
      const [exposures, outcomes] = await Promise.all([db.listExposures(e.id), db.listOutcomes(e.id)]);
      return summarise(exposures, outcomes, { control: controlOf(e), arms: e.arms.map((a) => a.key) });
    },
  };
}

export type ExperimentStore = ReturnType<typeof createExperimentStore>;
