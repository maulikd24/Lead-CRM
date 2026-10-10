"use client";

import { lazyNamed } from "./lazy-named";

/**
 * Lazy entry points. Server components import these instead of the motion components directly, so the motion
 * library only loads when one of them actually renders (NEXT_PUBLIC_MOTION=1) and never in the flag-off graph.
 */
export const LazyMotionProvider = lazyNamed(() => import("./motion-provider").then((m) => m.MotionProvider));
export const LazyPageTransition = lazyNamed(() => import("./page-transition").then((m) => m.PageTransition));
export const LazyFadeIn = lazyNamed(() => import("./fade-in").then((m) => m.FadeIn));
export const LazyStagger = lazyNamed(() => import("./fade-in").then((m) => m.Stagger));
export const LazyStaggerItem = lazyNamed(() => import("./fade-in").then((m) => m.StaggerItem));
export const LazyAnimatedProgressBar = lazyNamed(() => import("./animated-progress-bar").then((m) => m.AnimatedProgressBar));
export const LazyCountUp = lazyNamed(() => import("./count-up").then((m) => m.CountUp));
