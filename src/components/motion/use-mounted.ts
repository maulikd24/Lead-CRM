"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** False on the server and during hydration, true right after. Lets wrappers ship visible HTML and animate only once mounted. */
export function useMounted(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}
