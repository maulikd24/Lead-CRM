import Link from "next/link";
import { BookCheck, FileClock, Lock, UserCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { KpiStrip, KpiTile } from "@/components/workspace/kpi-strip";
import { ROLE_HOME } from "@/lib/front-door/fixtures";
import { TRUST_HEADING, TRUST_ITEMS } from "@/lib/front-door/trust-config";
import { TOUR_ROLES, probesFor, sidebarFor } from "@/lib/front-door/roles";

import { AllvestLogo } from "./allvest-logo";
import { BrowserFrame } from "./browser-frame";
import { GoogleButton } from "./google-button";
import { LazyAskDemo, LazyRoleSwitcher } from "./lazy";
import { Nav } from "./nav";
import { Story } from "./story";
import { ThemeScript } from "./theme-script";

import "./front-door.css";

const ICONS = { consent: BookCheck, audit: FileClock, roles: Lock, humans: UserCheck } as const;

function HeroFrame() {
  const home = ROLE_HOME.rm;
  return (
    <BrowserFrame url="customer-os / today" className="fd-hero-frame" label="Today screen, synthetic example">
      <div className="grid gap-3" inert>
        <div>
          <p className="m-0 text-lg font-bold">{home.title}</p>
          <p className="m-0 text-sm text-muted-foreground">{home.lead}</p>
        </div>
        <KpiStrip label="Today at a glance">
          {home.tiles.map((t, i) => (
            <KpiTile key={t.label} label={t.label} hint={t.hint} index={i}>
              {t.value}
            </KpiTile>
          ))}
        </KpiStrip>
        <div className="grid gap-2">
          {home.rows.map((r) => (
            <div key={r.primary} className="fd-row">
              <span>
                <b>{r.primary}</b>
                <small>{r.secondary}</small>
              </span>
              {r.chip && <Badge variant="outline">{r.chip}</Badge>}
            </div>
          ))}
        </div>
      </div>
    </BrowserFrame>
  );
}

/** The signed-out front door at the root: animated logo, headline, scroll story, role switcher, Ask demo, trust and footer. */
export function Landing({ googleAvailable, showTrust = false }: { googleAvailable: boolean; showTrust?: boolean }) {
  const tabs = TOUR_ROLES.map((r) => ({ key: r.key, label: r.label }));
  const sidebars = Object.fromEntries(TOUR_ROLES.map((r) => [r.key, sidebarFor(r.key)]));
  const probes = Object.fromEntries(TOUR_ROLES.map((r) => [r.key, probesFor(r.key).map((p) => ({ label: p.label, allowed: p.allowed }))]));

  return (
    <div className="fd">
      <ThemeScript />
      <a href="#main" className="fd-skip">Skip to main content</a>
      <Nav showTrust={showTrust} />
      <main id="main">
        <section className="fd-hero" aria-labelledby="fd-h1">
          <div className="fd-wrap">
            <AllvestLogo animate tagline title="Allvest" className="fd-hero-logo" />
            <p className="fd-eyebrow" style={{ marginTop: 30 }}>Allvest Customer OS</p>
            <h1 id="fd-h1">
              <span style={{ display: "block" }}>Know every customer.</span>
              <span style={{ display: "block" }}>
                <span className="fd-hl">Know what to do next.</span>
              </span>
            </h1>
            <p className="fd-sub">
              Run the whole customer journey, from first click to funded customer, in one place. Every suggestion shows its evidence, and a person approves everything that reaches a customer.
            </p>
            <div className="fd-cta">
              {googleAvailable ? <GoogleButton variant="primary" /> : <Link href="/login" className="fd-btn fd-btn-primary">Sign in</Link>}
              {googleAvailable ? (
                <Link href="/login" className="fd-link">Use email and password</Link>
              ) : (
                <a href="#story" className="fd-link">See how it works</a>
              )}
            </div>
            <p className="fd-fine">For Allvest staff and new joiners. An administrator gives you access.</p>
            <HeroFrame />
          </div>
        </section>

        <section id="story" className="fd-section fd-alt" aria-labelledby="fd-story-h">
          <div className="fd-wrap">
            <div className="fd-section-head fd-reveal">
              <p className="fd-eyebrow">From first click to funded customer</p>
              <h2 id="fd-story-h">One customer, one clear next step.</h2>
              <p>Follow a single example. Rahul is a synthetic HNI client with a complaint. Scroll to see what the system holds back, what it chooses and what it remembers.</p>
            </div>
            <Story />
          </div>
        </section>

        <section id="roles" className="fd-section" aria-labelledby="fd-roles-h">
          <div className="fd-wrap">
            <div className="fd-section-head fd-reveal">
              <p className="fd-eyebrow">One system, built for each role</p>
              <h2 id="fd-roles-h">The same product. A different view for everyone.</h2>
              <p>Switch roles to see the sidebar and home change. What a role cannot open is simply not there: Marketing never sees customer names, and an RM never sees ad spend.</p>
            </div>
            <LazyRoleSwitcher tabs={tabs} sidebars={sidebars} probes={probes} />
          </div>
        </section>

        <section id="ask" className="fd-section fd-alt" aria-labelledby="fd-ask-h">
          <div className="fd-wrap">
            <div className="fd-section-head fd-reveal">
              <p className="fd-eyebrow">Ask Allvest</p>
              <h2 id="fd-ask-h">Ask in plain words. See where the answer came from.</h2>
              <p>This is a scripted demo with fixed answers. No AI is called on this page and no real customer is shown.</p>
            </div>
            <LazyAskDemo />
          </div>
        </section>

        {showTrust && (
          <section id="trust" className="fd-section" aria-labelledby="fd-trust-h">
            <div className="fd-wrap">
              <div className="fd-section-head fd-reveal">
                <p className="fd-eyebrow">{TRUST_HEADING.eyebrow}</p>
                <h2 id="fd-trust-h">{TRUST_HEADING.title}</h2>
              </div>
              <div className="fd-trust fd-reveal">
                {TRUST_ITEMS.map((t) => {
                  const Icon = ICONS[t.id];
                  return (
                    <div key={t.id}>
                      <Icon className="size-6" aria-hidden="true" />
                      <h3>{t.title}</h3>
                      <p>{t.body}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        <section className="fd-section fd-alt" aria-labelledby="fd-end-h" style={{ textAlign: "center" }}>
          <div className="fd-wrap fd-narrow">
            <h2 id="fd-end-h" className="fd-display" style={{ margin: 0, fontSize: "clamp(1.75rem, 4vw, 2.75rem)", lineHeight: 1.1, fontWeight: 700 }}>
              Ready when you are.
            </h2>
            <div className="fd-cta">
              {googleAvailable ? <GoogleButton variant="primary" /> : <Link href="/login" className="fd-btn fd-btn-primary">Sign in</Link>}
            </div>
            <p className="fd-fine">New here? Ask an administrator to add you. Nobody can sign themselves up.</p>
          </div>
        </section>
      </main>

      <footer className="fd-foot">
        <div className="fd-wrap fd-foot-in">
          <div>
            <strong>Allvest Customer OS</strong>
          </div>
          <p>Examples on this page are synthetic. They are not real customers, results or numbers.</p>
        </div>
      </footer>
    </div>
  );
}
