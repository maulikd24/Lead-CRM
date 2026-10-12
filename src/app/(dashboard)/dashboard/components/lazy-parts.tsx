"use client";

import { lazyNamed } from "@/components/motion/lazy-named";

/** Dashboard pieces that use the motion library, loaded on demand (flag on only). */
export const LazyLiveFunnel = lazyNamed(() => import("./live-funnel").then((m) => m.LiveFunnel));
export const LazySparkline = lazyNamed(() => import("./sparkline").then((m) => m.Sparkline));
export const LazyPipelineTrendChartAnimated = lazyNamed(() => import("./pipeline-trend-chart-animated").then((m) => m.PipelineTrendChartAnimated));
export const LazyFundedCelebration = lazyNamed(() => import("./funded-celebration").then((m) => m.FundedCelebration));
