import { DEMO_BANNER_TEXT, demoBannerVisible } from "@/lib/demo/banner";

/** A strip above the page while demo mode is on. Renders nothing otherwise. */
export function DemoBanner({ visible = demoBannerVisible() }: { visible?: boolean }) {
  if (!visible) return null;
  return (
    <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      {DEMO_BANNER_TEXT}
    </div>
  );
}
