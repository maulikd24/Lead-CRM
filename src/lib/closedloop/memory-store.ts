import type { NewOutboxRow, OutboxRow, OutboxStore } from "./types";

/** In-memory OutboxStore for tests and the demo. Same contract as the Prisma store. */
export class MemoryOutbox implements OutboxStore {
  rows: OutboxRow[] = [];
  private n = 0;

  async insertIfAbsent(row: NewOutboxRow, now: Date) {
    if (this.rows.some((r) => r.destination === row.destination && r.dedupId === row.dedupId)) return { created: false };
    this.rows.push({
      id: `o${++this.n}`, clientId: row.clientId, destination: row.destination, eventType: row.eventType, qualifier: row.qualifier, dedupId: row.dedupId,
      occurredAt: row.occurredAt, status: row.status ?? "PENDING", reason: row.reason ?? null, attempts: 0, nextAttemptAt: null, claimedAt: null, sentAt: null,
      lastError: null, matched: null, identity: row.identity, value: row.value, createdAt: now,
    });
    return { created: true };
  }
  private isDue(r: OutboxRow, now: Date, stale: Date) {
    return r.status === "PENDING" || (r.status === "FAILED" && !!r.nextAttemptAt && r.nextAttemptAt <= now) || (r.status === "SENDING" && !!r.claimedAt && r.claimedAt < stale);
  }
  async due(now: Date, staleBefore: Date, limit: number) {
    return this.rows.filter((r) => this.isDue(r, now, staleBefore)).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()).slice(0, limit).map((r) => ({ ...r }));
  }
  async claim(id: string, now: Date, staleBefore: Date) {
    const r = this.rows.find((x) => x.id === id);
    if (!r || !this.isDue(r, now, staleBefore)) return null;
    r.status = "SENDING";
    r.claimedAt = now;
    r.attempts += 1;
    return { ...r };
  }
  private get(id: string) {
    const r = this.rows.find((x) => x.id === id);
    if (!r) throw new Error("no such row");
    return r;
  }
  async markSent(id: string, now: Date, matched: boolean | null) {
    Object.assign(this.get(id), { status: "SENT", sentAt: now, matched, nextAttemptAt: null, lastError: null, reason: null });
  }
  async markRetry(id: string, nextAttemptAt: Date, error: string) {
    Object.assign(this.get(id), { status: "FAILED", nextAttemptAt, lastError: error, reason: error });
  }
  async markDead(id: string, error: string) {
    Object.assign(this.get(id), { status: "DEAD", lastError: error, reason: error, nextAttemptAt: null });
  }
  async markSkipped(id: string, reason: string) {
    Object.assign(this.get(id), { status: "SKIPPED", reason, nextAttemptAt: null });
  }
  async requeue(id: string, now: Date) {
    void now;
    const r = this.get(id);
    if (r.status !== "DEAD" && r.status !== "FAILED") return false;
    Object.assign(r, { status: "PENDING", attempts: 0, nextAttemptAt: null, lastError: null, reason: null });
    return true;
  }
  async cancelUnsentForClient(clientId: string, reason: string) {
    let n = 0;
    for (const r of this.rows) if (r.clientId === clientId && ["PENDING", "FAILED", "SENDING"].includes(r.status)) { Object.assign(r, { status: "SKIPPED", reason, nextAttemptAt: null }); n++; }
    return n;
  }
}
