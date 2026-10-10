"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

const noop = () => () => {};

/**
 * Light/dark in one click, in the top bar. The two icons swap with a short rotate (200ms, none under reduced motion).
 * Before hydration it renders an inert placeholder of the same size, so the bar never shifts.
 */
export function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) return <Button variant="ghost" size="icon-sm" aria-hidden tabIndex={-1} className="pointer-events-none" />;
  const dark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={dark ? "Switch to the light theme" : "Switch to the dark theme"}
      onClick={() => {
        setTheme(dark ? "light" : "dark");
        toast.success(`Switched to the ${dark ? "light" : "dark"} theme`);
      }}
      className="relative overflow-hidden"
    >
      <Sun aria-hidden className={`absolute size-4 transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none ${dark ? "scale-100 rotate-0 opacity-100" : "scale-50 -rotate-90 opacity-0"}`} />
      <Moon aria-hidden className={`absolute size-4 transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none ${dark ? "scale-50 rotate-90 opacity-0" : "scale-100 rotate-0 opacity-100"}`} />
    </Button>
  );
}
