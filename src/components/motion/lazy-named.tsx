"use client";

import { lazy, Suspense, type ComponentType, type JSX } from "react";

/** Tiny `React.lazy` wrapper (no next/dynamic runtime): the module loads only when the component renders; SSR still streams its HTML. */
export function lazyNamed<P extends object>(loader: () => Promise<ComponentType<P>>): (props: P) => JSX.Element {
  const Inner = lazy(async () => ({ default: await loader() }));
  const Lazy = (props: P) => (
    <Suspense fallback={null}>
      <Inner {...(props as P & JSX.IntrinsicAttributes)} />
    </Suspense>
  );
  return Lazy;
}
