import { cn } from "@/lib/utils";

import { ARROW, BURST, LOGO_VIEWBOX, LOGO_VIEWBOX_TAGLINE, STROKE, WORDMARK_GREEN, WORDMARK_LIME } from "./logo-paths";

/** Brand colours. Deep green reads on the light canvas; on the dark canvas the text part switches to a pale green. */
export const BRAND = { green: "#0E423E", lime: "#99CC01" } as const;

type Props = {
  /** Play the one-shot draw-in (burst and arrow assemble, then settle). Instant under prefers-reduced-motion. */
  animate?: boolean;
  /** Show the mark only (square), for a small nav or favicon-like use. */
  markOnly?: boolean;
  tagline?: boolean;
  className?: string;
  /** Accessible name. Omit when the logo sits next to text that already says "Allvest". */
  title?: string;
};

const MARK_VIEWBOX = "306 758 280 320";

/**
 * Inline SVG logo: mark (burst and arrow) and wordmark. No raster file. The drawing paths use `pathLength="1"` so a single
 * dash animation (defined in front-door.css as .fd-draw) draws them; every segment is under 300 ms and plays once.
 */
export function AllvestLogo({ animate = false, markOnly = false, tagline = false, className, title }: Props) {
  const viewBox = markOnly ? MARK_VIEWBOX : tagline ? LOGO_VIEWBOX_TAGLINE : LOGO_VIEWBOX;
  const strokeProps = { strokeWidth: STROKE, fill: "none", strokeLinejoin: "miter", strokeLinecap: "butt", pathLength: 1 } as const;
  return (
    <svg
      viewBox={viewBox}
      xmlns="http://www.w3.org/2000/svg"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={cn("fd-logo", animate && "fd-logo-animate", className)}
    >
      <g className="fd-logo-mark">
        <g stroke="var(--fd-logo-green)">
          {BURST.map((p, i) => (
            <path key={p.id} d={p.d} {...strokeProps} className="fd-draw" style={{ ["--d" as string]: `${i * 60}ms` }} />
          ))}
        </g>
        <g stroke={BRAND.lime}>
          {ARROW.map((p, i) => (
            <path key={p.id} d={p.d} {...strokeProps} className="fd-draw" style={{ ["--d" as string]: `${360 + i * 90}ms` }} />
          ))}
        </g>
      </g>
      {!markOnly && (
        <g className="fd-logo-word">
          <g stroke={BRAND.lime} fill={BRAND.lime}>
            {WORDMARK_LIME.strokes.map((d) => (
              <path key={d} d={d} fill="none" strokeWidth={STROKE + 2} strokeLinejoin="round" />
            ))}
            {WORDMARK_LIME.rects.map((r) => (
              <rect key={r.x} x={r.x} y={r.y} width={r.w} height={r.h} stroke="none" />
            ))}
          </g>
          <g stroke="var(--fd-logo-green)" fill="var(--fd-logo-green)">
            {WORDMARK_GREEN.polys.map((points) => (
              <polygon key={points} points={points} stroke="none" />
            ))}
            {WORDMARK_GREEN.strokes.map((d) => (
              <path key={d} d={d} fill="none" strokeWidth={STROKE + 2} strokeLinejoin="round" />
            ))}
          </g>
          {tagline && (
            <text x="315" y="1160" fill="var(--fd-logo-green)" fontFamily="var(--font-sora), sans-serif" fontWeight={600} fontSize="62" textLength="1303" lengthAdjust="spacingAndGlyphs">
              SMART INVESTMENTS MADE EASY
            </text>
          )}
        </g>
      )}
    </svg>
  );
}
