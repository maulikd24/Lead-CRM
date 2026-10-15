"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A horizontally scrolling wrapper that a keyboard user can reach: it joins the tab order only while its content really
 * overflows (a table on a phone), so wide tables stay scrollable with the arrow keys without adding a tab stop to every table.
 * Behaviour and layout are those of a plain `overflow-x-auto` div.
 */
function ScrollRegion({ className, ...props }: React.ComponentProps<"div">) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [scrollable, setScrollable] = React.useState(false)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setScrollable(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
    check()
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(check)
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      tabIndex={scrollable ? 0 : undefined}
      className={cn(
        "overflow-x-auto focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
        className
      )}
      {...props}
    />
  )
}

export { ScrollRegion }
