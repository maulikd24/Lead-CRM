/** Campaign attribution (Journey tab, Campaign impact, lead push, lead leakage). Build-time flag, off unless exactly "1". */
export function attributionEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_ATTRIBUTION === "1";
}
