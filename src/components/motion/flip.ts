import { DURATION } from "./tokens";

/**
 * FLIP with the browser's own animation API (no layout features of the motion library needed): give it where an element was
 * (a rect captured before the change) and it glides from there into its new place, once, then flashes a soft ring to say
 * "landed here". Does nothing under reduced motion.
 */
export function flipFrom(el: HTMLElement, from: DOMRect) {
  if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const to = el.getBoundingClientRect();
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const ms = DURATION.slow * 1000;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], { duration: ms, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  }
  el.animate([{ boxShadow: "0 0 0 2px var(--primary)" }, { boxShadow: "0 0 0 0 transparent" }], { duration: ms, delay: ms * 0.6, easing: "ease-out" });
}
