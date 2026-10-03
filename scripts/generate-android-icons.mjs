// Renders the Supportify logo into the Android app's launcher icons (legacy, round, adaptive foreground)
// and splash screens, replacing the Capacitor defaults. Run from the repo root after `cap add android`:
//   node scripts/generate-android-icons.mjs
import { readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const RES = "android-app/android/app/src/main/res";
const PRIMARY = "#197852";
const GLYPH = "#f6faf6";

const glyph = (sw) => `
  <path d="M9 20.5L13.5 15L17.5 18.5L23 11.5" stroke="${GLYPH}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="M19 11.5H23V15.5" stroke="${GLYPH}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;

const svg = (inner, size) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">${inner}</svg>`);
const render = (inner, size) => sharp(svg(inner, size), { density: 384 }).resize(size, size).png();

const legacy = `<rect width="32" height="32" rx="7" fill="${PRIMARY}"/><g transform="translate(16 16) scale(1.1) translate(-16 -16)">${glyph(2.25)}</g>`;
const round = `<circle cx="16" cy="16" r="16" fill="${PRIMARY}"/>${glyph(2.25)}`;
// Adaptive foreground: transparent, glyph kept inside the central 66% safe zone of the 108dp canvas.
const foreground = `<g transform="translate(16 16) scale(0.62) translate(-16 -16)">${glyph(2.6)}</g>`;

const densities = { mdpi: [48, 108], hdpi: [72, 162], xhdpi: [96, 216], xxhdpi: [144, 324], xxxhdpi: [192, 432] };
for (const [name, [icon, fg]] of Object.entries(densities)) {
  const dir = join(RES, `mipmap-${name}`);
  await render(legacy, icon).toFile(join(dir, "ic_launcher.png"));
  await render(round, icon).toFile(join(dir, "ic_launcher_round.png"));
  await render(foreground, fg).toFile(join(dir, "ic_launcher_foreground.png"));
}
writeFileSync(
  join(RES, "values", "ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${PRIMARY}</color>\n</resources>\n`,
);

// Splash: solid brand colour with the glyph centred, same pixel size as each existing splash image.
for (const dirName of readdirSync(RES).filter((d) => d.startsWith("drawable"))) {
  const file = join(RES, dirName, "splash.png");
  if (!existsSync(file)) continue;
  const { width, height } = await sharp(file).metadata();
  const glyphSize = Math.round(Math.min(width, height) * 0.28);
  const mark = await render(`<rect width="32" height="32" rx="7" fill="${GLYPH}"/>` + glyph(2.25).replaceAll(GLYPH, PRIMARY), glyphSize).toBuffer();
  await sharp({ create: { width, height, channels: 3, background: PRIMARY } })
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toFile(file);
}
console.log("Android icons and splash regenerated");
