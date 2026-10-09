import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPoller } from "./live-poller";

const counts = { totals: { leads: 1, kyc: 0, funded: 0, activated: 0 }, newToday: 0, newestLeadAt: null, at: "x" };

function setup(opts: { visible?: boolean; fetchImpl?: (s: AbortSignal) => Promise<typeof counts> } = {}) {
  let visible = opts.visible ?? true;
  const fetchCounts = vi.fn(opts.fetchImpl ?? (async () => counts));
  const onData = vi.fn();
  const onStatus = vi.fn();
  const poller = createPoller({ fetchCounts, onData, onStatus, isVisible: () => visible });
  return { poller, fetchCounts, onData, onStatus, setVisible: (v: boolean) => (visible = v) };
}

describe("createPoller", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("polls every 20 s on a single chain", async () => {
    const t = setup();
    t.poller.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(t.fetchCounts).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(t.fetchCounts).toHaveBeenCalledTimes(2);
    t.poller.stop();
  });

  it("does not start a second chain when the tab becomes visible during an in-flight fetch", async () => {
    let release!: () => void;
    let n = 0;
    const t = setup({ fetchImpl: () => (n++ === 0 ? new Promise((res) => (release = () => res(counts))) : Promise.resolve(counts)) });
    t.poller.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(t.fetchCounts).toHaveBeenCalledTimes(1);
    t.setVisible(false);
    t.poller.visibilityChanged();
    t.setVisible(true);
    t.poller.visibilityChanged();
    expect(t.fetchCounts).toHaveBeenCalledTimes(1); // still the in-flight one
    release();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(t.fetchCounts).toHaveBeenCalledTimes(2); // exactly one chain continues
    await vi.advanceTimersByTimeAsync(20_000);
    expect(t.fetchCounts).toHaveBeenCalledTimes(3);
    t.poller.stop();
  });

  it("enforces a 5 s minimum interval on rapid visibility toggles", async () => {
    const t = setup();
    t.poller.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(t.fetchCounts).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) t.poller.visibilityChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.fetchCounts).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.fetchCounts.mock.calls.length).toBeLessThanOrEqual(2);
    t.poller.stop();
  });

  it("pauses while hidden and reports status", async () => {
    const t = setup({ visible: false });
    t.poller.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.fetchCounts).not.toHaveBeenCalled();
    expect(t.onStatus).toHaveBeenLastCalledWith("paused");
    t.poller.stop();
  });

  it("backs off after failures and recovers", async () => {
    let fail = true;
    const t = setup({ fetchImpl: async () => { if (fail) throw new Error("x"); return counts; } });
    t.poller.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(t.onStatus).toHaveBeenLastCalledWith("backoff");
    await vi.advanceTimersByTimeAsync(39_000);
    expect(t.fetchCounts).toHaveBeenCalledTimes(1);
    fail = false;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.fetchCounts).toHaveBeenCalledTimes(2);
    expect(t.onStatus).toHaveBeenLastCalledWith("live");
    t.poller.stop();
  });

  it("aborts the in-flight request and stops on cleanup", async () => {
    let signal!: AbortSignal;
    const t = setup({ fetchImpl: (s) => { signal = s; return new Promise(() => {}); } });
    t.poller.start();
    await vi.advanceTimersByTimeAsync(20_000);
    t.poller.stop();
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(200_000);
    expect(t.fetchCounts).toHaveBeenCalledTimes(1);
  });
});
