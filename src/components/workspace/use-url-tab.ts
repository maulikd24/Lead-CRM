"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { parseTabParam, TAB_PARAM, tabHref } from "./tab-logic";

/**
 * Tab state that lives in the URL (?tab=), so a tab can be deep-linked, and back/forward step through the tabs you visited.
 * A selection is a `history.pushState` (Next keeps `useSearchParams` in sync with it), so it is instant: no server round trip.
 */
export function useUrlTab(keys: readonly string[], fallback: string, param: string = TAB_PARAM) {
  const search = useSearchParams();
  const pathname = usePathname();
  const tab = parseTabParam(search.get(param), keys, fallback);
  const qs = search.toString();

  const hrefFor = useCallback((key: string) => tabHref(pathname, qs ? `?${qs}` : "", key, { fallback, param }), [pathname, qs, fallback, param]);
  const select = useCallback(
    (key: string) => {
      if (key === tab) return;
      window.history.pushState(null, "", hrefFor(key));
    },
    [hrefFor, tab],
  );
  return { tab, select, hrefFor };
}
