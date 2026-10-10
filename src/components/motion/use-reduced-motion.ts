"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** Pure reader so it can be tested without a DOM. */
export function readReducedMotion(matchMedia: ((q: string) => MediaQueryList) | undefined): boolean {
  return matchMedia ? matchMedia(QUERY).matches : false;
}

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const getSnapshot = () => readReducedMotion(typeof window !== "undefined" ? window.matchMedia?.bind(window) : undefined);

/** True when the user asked for reduced motion. SSR-safe: the server snapshot is `false`, so final values render server-side. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
