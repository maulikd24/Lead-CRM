import Link from "next/link";

import { AllvestLogo } from "./allvest-logo";
import { NavScroll } from "./nav-scroll";
import { ThemeToggle } from "./theme-toggle";

/** Slim top bar. The small logo appears once the hero logo has scrolled away; "Sign in" is always there. */
export function Nav({ showTrust = true }: { showTrust?: boolean }) {
  return (
    <>
      <div id="fd-top" aria-hidden="true" style={{ position: "absolute", top: 0, height: 220, width: 1, pointerEvents: "none" }} />
      <NavScroll>
        <header className="fd-nav" data-scrolled="false">
          <div className="fd-wrap fd-nav-in">
            <Link href="/" className="fd-nav-brand" aria-label="Allvest Customer OS, top of page">
              <AllvestLogo markOnly />
              <span>Customer OS</span>
            </Link>
            <nav aria-label="Page sections" className="fd-nav-links">
              <a href="#story">How it works</a>
              <a href="#roles">Roles</a>
              <a href="#ask">Ask</a>
              {showTrust && <a href="#trust">Trust</a>}
            </nav>
            <div className="fd-nav-actions">
              <ThemeToggle />
              <Link href="/login" className="fd-btn fd-btn-ghost fd-btn-sm">Sign in</Link>
            </div>
          </div>
        </header>
      </NavScroll>
    </>
  );
}
