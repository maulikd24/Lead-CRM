import { qrMatrix } from "@/lib/planner/qr";

/** The QR code of a tracked link as an inline SVG (no image request, no third party). The label is the link, so a screen reader says what it opens. */
export function QrSvg({ text, label, size = 132 }: { text: string; label: string; size?: number }) {
  const m = qrMatrix(text);
  const quiet = 2;
  const n = m.length + quiet * 2;
  const path = m.flatMap((row, r) => row.map((dark, c) => (dark ? `M${c + quiet} ${r + quiet}h1v1h-1z` : ""))).join("");
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" className="rounded-md border bg-white">
      <rect width={n} height={n} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
