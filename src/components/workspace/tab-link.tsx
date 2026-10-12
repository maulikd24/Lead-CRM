"use client";

import { type ComponentProps } from "react";

import { useUrlTab } from "./use-url-tab";

/**
 * A link elsewhere on the page (a rail chip, a "view all" button) that opens a tab of a client-driven workspace.
 * Same instant, URL-synced switch as the tab bar; a modified click still opens the tab in a new window.
 */
export function TabLink({ tab, keys, fallback, onClick, children, ...rest }: Omit<ComponentProps<"a">, "href"> & { tab: string; keys: readonly string[]; fallback: string }) {
  const { select, hrefFor } = useUrlTab(keys, fallback);
  return (
    <a
      {...rest}
      href={hrefFor(tab)}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        select(tab);
      }}
    >
      {children}
    </a>
  );
}
