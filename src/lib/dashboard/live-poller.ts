import { LIVE } from "@/components/motion/tokens";
import { nextPollDelay } from "./live-funnel";
import type { LiveCounts } from "./live-counts";

export type PollStatus = "live" | "backoff" | "paused";

type Options = {
  fetchCounts: (signal: AbortSignal) => Promise<LiveCounts>;
  onData: (counts: LiveCounts) => void;
  onStatus?: (status: PollStatus) => void;
  isVisible: () => boolean;
};

/**
 * One timer chain, one request at a time, at least 5 s between requests, aborted on stop.
 * Hidden tabs do not poll; becoming visible triggers a (throttled) refresh.
 */
export function createPoller({ fetchCounts, onData, onStatus, isVisible }: Options) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let inFlight = false;
  let stopped = true;
  let failures = 0;
  let lastFetchAt = -Infinity;

  const schedule = (delay: number) => {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(run, delay);
  };

  async function run() {
    clearTimeout(timer);
    if (stopped || inFlight) return;
    if (!isVisible()) return onStatus?.("paused");
    const wait = LIVE.minIntervalMs - (Date.now() - lastFetchAt);
    if (wait > 0) return schedule(wait);
    inFlight = true;
    lastFetchAt = Date.now();
    controller = new AbortController();
    try {
      onData(await fetchCounts(controller.signal));
      failures = 0;
      onStatus?.("live");
    } catch {
      if (stopped) return;
      failures += 1;
      onStatus?.("backoff");
    } finally {
      inFlight = false;
    }
    schedule(nextPollDelay(failures));
  }

  return {
    start() {
      stopped = false;
      schedule(nextPollDelay(0));
      if (!isVisible()) onStatus?.("paused");
    },
    visibilityChanged() {
      if (stopped) return;
      if (isVisible()) void run();
      else {
        clearTimeout(timer);
        onStatus?.("paused");
      }
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
    },
  };
}
