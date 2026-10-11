"use client";

import { useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { KpiStrip, KpiTile } from "@/components/workspace/kpi-strip";
import { ROLE_HOME } from "@/lib/front-door/fixtures";

import { BrowserFrame } from "./browser-frame";

export type RoleTab = { key: keyof typeof ROLE_HOME; label: string };
export type SidebarGroup = { group: string; items: string[] };
export type Probe = { label: string; allowed: boolean };

const article = (label: string) => (label === "Control plane" ? "an Admin" : `${/^[AEIOU]/i.test(label) ? "an" : "a"} ${label}`);

/**
 * Role switcher: pick a role and the sidebar and home change. The sidebar and the "can they open it" answers come from the
 * live access registry (computed on the server and passed in); the home content is synthetic. Keyboard: Left/Right/Home/End.
 */
export default function RoleSwitcher({ tabs, sidebars, probes }: { tabs: RoleTab[]; sidebars: Record<string, SidebarGroup[]>; probes: Record<string, Probe[]> }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const tab = tabs[active];
  const home = ROLE_HOME[tab.key];

  const move = (to: number) => {
    const next = (to + tabs.length) % tabs.length;
    setActive(next);
    refs.current[next]?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") move(active + 1);
    else if (e.key === "ArrowLeft") move(active - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(tabs.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div>
      <div role="tablist" aria-label="Choose a role" className="fd-tabs" onKeyDown={onKey}>
        {tabs.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`fd-role-tab-${t.key}`}
            aria-selected={i === active}
            aria-controls="fd-role-panel"
            tabIndex={i === active ? 0 : -1}
            className="fd-tab"
            onClick={() => setActive(i)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id="fd-role-panel" role="tabpanel" aria-labelledby={`fd-role-tab-${tab.key}`} className="fd-roles">
        <BrowserFrame url={`customer-os / ${home.title.toLowerCase().replace(/\s+/g, "-")}`} label={`${tab.label} view, synthetic example`}>
          <div className="fd-app" style={{ margin: "calc(-1 * clamp(14px, 2.4vw, 24px))" }}>
            <nav className="fd-side" aria-label={`${tab.label} sidebar`}>
              {sidebars[tab.key].map((g, gi) => (
                <div key={`${tab.key}-${g.group}`} className="fd-swap">
                  <h5>{g.group}</h5>
                  <ul>
                    {g.items.map((item, i) => (
                      <li key={item} data-first={gi === 0 && i === 0}>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
            <div className="fd-main fd-swap" key={`m-${tab.key}`}>
              <div>
                <h4 className="m-0 text-lg font-bold">{home.title}</h4>
                <p className="m-0 mt-1 text-sm text-muted-foreground">{home.lead}</p>
              </div>
              <KpiStrip label={`${tab.label} key figures`}>
                {home.tiles.map((t, i) => (
                  <KpiTile key={t.label} label={t.label} hint={t.hint} index={i}>
                    {t.value}
                  </KpiTile>
                ))}
              </KpiStrip>
              <div>
                <p className="m-0 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{home.listTitle}</p>
                <div className="grid gap-2" role="list">
                  {home.rows.map((r) => (
                    <div key={r.primary} className="fd-row" role="listitem">
                      <span>
                        <b>{r.primary}</b>
                        <small>{r.secondary}</small>
                      </span>
                      {r.chip && <Badge variant="outline">{r.chip}</Badge>}
                    </div>
                  ))}
                </div>
              </div>
              <p className="m-0 text-xs text-muted-foreground">{home.syntheticNote}</p>
            </div>
          </div>
        </BrowserFrame>

        <div className="grid gap-4">
          <section className="fd-card-plain" aria-labelledby="fd-probe-title">
            <h3 id="fd-probe-title">Can {article(tab.label)} open it?</h3>
            <p>Answered by the same access rules the product uses. Anything not granted is denied.</p>
            <ul className="fd-probe" key={`p-${tab.key}`}>
              {probes[tab.key].map((p) => (
                <li key={p.label} className="fd-swap">
                  <span className={p.allowed ? "fd-yes" : "fd-no"} aria-hidden="true">
                    {p.allowed ? "✓" : "✕"}
                  </span>
                  <span>{p.label}</span>
                  <small>{p.allowed ? "Yes" : "No"}</small>
                </li>
              ))}
            </ul>
          </section>
          <section className="fd-card-plain" aria-labelledby="fd-tour-title">
            <h3 id="fd-tour-title">A short tour</h3>
            <ul className="fd-tour">
              {home.tour.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
