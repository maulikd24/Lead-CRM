/**
 * The Allvest logo, redrawn as clean geometry (no raster). Coordinates share one space (viewBox LOGO_VIEWBOX).
 * The mark is a deep-green burst and a lime arrow; the wordmark is "all" in lime and "vest" in deep green.
 * Strokes use butt caps so the ends are square like the brand artwork.
 */
export const LOGO_VIEWBOX = "300 758 1340 320";
export const LOGO_VIEWBOX_TAGLINE = "300 758 1340 430";

export const STROKE = 32;

/** Burst spokes: centre (443, 892); each is a straight stroke, drawn outwards from the centre. */
export const BURST = [
  { id: "n", d: "M443 892 V772" },
  { id: "nw", d: "M443 892 L359 808" },
  { id: "ne", d: "M443 892 L527 808" },
  { id: "e", d: "M443 892 H566" },
  { id: "se", d: "M443 892 L527 976" },
  { id: "s", d: "M443 892 V926" },
] as const;

/** The arrow: its head (corner) and its tail (diagonal shaft that bends into the base). */
export const ARROW = [
  { id: "head", d: "M321 906 H429 V1012" },
  { id: "tail", d: "M429 906 L342 993 C320 1015 328 1043 360 1043 H445" },
] as const;

/** Wordmark pieces, filled shapes. "l" and "v" are plain polygons; a, e, s, t are strokes of the same weight. */
export const WORDMARK_LIME = {
  strokes: [
    // a: single-storey, stem on the right with a bowl
    "M616 932 C628 906 654 899 690 899 C730 899 749 913 749 950 V1040",
    "M749 978 L688 983 C648 987 616 995 616 1025 C616 1050 640 1046 668 1045 C718 1043 749 1030 749 978",
  ],
  rects: [
    { x: 800, y: 810, w: 33, h: 246 },
    { x: 892, y: 810, w: 33, h: 246 },
  ],
} as const;

export const WORDMARK_GREEN = {
  polys: ["960,887 997,887 1046,1022 1096,887 1132,887 1068,1056 1026,1056"],
  strokes: [
    // e
    "M1180 957 H1306 C1306 920 1275 901 1230 901 C1185 901 1164 933 1164 972 C1164 1015 1190 1043 1233 1043 C1268 1043 1294 1030 1304 1006",
    // s
    "M1478 936 C1472 910 1448 900 1420 900 C1385 900 1362 915 1362 935 C1362 960 1392 962 1420 966 C1458 971 1488 978 1488 1005 C1488 1030 1462 1043 1420 1043 C1385 1043 1358 1030 1350 1005",
    // t: stem then a hook; the crossbar is below
    "M1555 840 V1005 C1555 1030 1568 1043 1595 1043 H1618",
    "M1500 901 H1618",
  ],
} as const;
