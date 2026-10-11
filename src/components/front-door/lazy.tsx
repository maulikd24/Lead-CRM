"use client";

import dynamic from "next/dynamic";

import { useNear } from "./use-near";
import type { Probe, RoleTab, SidebarGroup } from "./role-switcher";

const RoleSwitcher = dynamic(() => import("./role-switcher"), { ssr: false });
const AskDemo = dynamic(() => import("./ask-demo"), { ssr: false });

/** Loads the role switcher's code only when its section is about to be seen; the placeholder holds the height so nothing shifts. */
export function LazyRoleSwitcher(props: { tabs: RoleTab[]; sidebars: Record<string, SidebarGroup[]>; probes: Record<string, Probe[]> }) {
  const [ref, near] = useNear<HTMLDivElement>();
  return (
    <div ref={ref} style={{ minHeight: 640 }}>
      {near ? <RoleSwitcher {...props} /> : null}
    </div>
  );
}

export function LazyAskDemo() {
  const [ref, near] = useNear<HTMLDivElement>();
  return (
    <div ref={ref} style={{ minHeight: 420 }}>
      {near ? <AskDemo /> : null}
    </div>
  );
}
