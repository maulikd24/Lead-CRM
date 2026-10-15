/** The demo banner shows only when the build-time demo indicator is on (NEXT_PUBLIC_DEMO_MODE=1, the twin of DEMO_MODE). */
export function demoBannerVisible(value: string | undefined = process.env.NEXT_PUBLIC_DEMO_MODE): boolean {
  return value === "1";
}

export const DEMO_BANNER_TEXT = "Demo data: nothing here is a real customer";
