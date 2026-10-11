"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

import { THEME_KEY } from "./theme-script";

type Theme = "light" | "dark";

const read = (): Theme => (document.documentElement.getAttribute("data-fd-theme") === "dark" ? "dark" : "light");
function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-fd-theme"] });
  return () => mo.disconnect();
}

/** Light/dark switch for the front door. Remembers the choice per visitor when storage works; works without it. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, read, () => "light" as Theme);
  const next: Theme = theme === "dark" ? "light" : "dark";
  const choose = () => {
    document.documentElement.setAttribute("data-fd-theme", next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage blocked: the choice lasts for this page only */
    }
  };
  return (
    <button type="button" className="fd-toggle" onClick={choose} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      {theme === "dark" ? <Sun className="size-5" aria-hidden="true" /> : <Moon className="size-5" aria-hidden="true" />}
    </button>
  );
}
