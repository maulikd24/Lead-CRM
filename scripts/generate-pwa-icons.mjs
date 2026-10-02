// Renders the Supportify logo (src/components/logo.tsx) to the PNG icons the web app manifest and iOS
// need. Run from the repo root: `node scripts/generate-pwa-icons.mjs`. The PNGs are committed, so this
// only needs re-running if the logo or brand colour changes.
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const PRIMARY = "#197852"; // --primary, oklch(0.51 0.105 161)
const GLYPH = "#f6faf6"; // --primary-foreground

// Same trend-arrow glyph as the Logo component, in its 32x32 coordinate space.
const glyph = (strokeWidth) => `
  <path d="M9 20.5L13.5 15L17.5 18.5L23 11.5" stroke="${GLYPH}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="M19 11.5H23V15.5" stroke="${GLYPH}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;

// "any" icon: the rounded-square logo exactly as in the app, transparent corners.
const roundedSvg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="${PRIMARY}"/>${glyph(2.25)}
</svg>`;

// Full-bleed icon (Android maskable + iOS apple-touch): the OS applies its own mask/rounding, so no
// transparent corners, and the glyph is scaled up around the centre but stays inside the ~80% safe zone.
const fullBleedSvg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="${PRIMARY}"/>
  <g transform="translate(16 16) scale(1.2) translate(-16 -16)">${glyph(2.25)}</g>
</svg>`;

const outputs = [
  { path: "public/icons/icon-192.png", size: 192, svg: roundedSvg },
  { path: "public/icons/icon-512.png", size: 512, svg: roundedSvg },
  { path: "public/icons/icon-512-maskable.png", size: 512, svg: fullBleedSvg, opaque: true },
  { path: "src/app/apple-icon.png", size: 180, svg: fullBleedSvg, opaque: true },
];

mkdirSync("public/icons", { recursive: true });
for (const { path, size, svg, opaque } of outputs) {
  let image = sharp(Buffer.from(svg(size)), { density: 384 }).resize(size, size);
  if (opaque) image = image.removeAlpha(); // full-bleed icons are already solid; iOS prefers no alpha channel
  await image.png().toFile(path);
  console.log(`wrote ${path} (${size}x${size})`);
}
