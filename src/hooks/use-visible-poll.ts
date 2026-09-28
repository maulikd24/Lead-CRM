"use client";

import { useEffect, useRef } from "react";

/** Interval polling that pauses while the tab is hidden and refreshes immediately when it returns. */
export function useVisiblePoll(callback: () => void | Promise<void>, intervalMs: number) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer === null) timer = setInterval(() => void callbackRef.current(), intervalMs);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else {
        void callbackRef.current();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs]);
}
