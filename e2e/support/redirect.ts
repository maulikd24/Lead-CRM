import type { Page } from "@playwright/test";

/**
 * Open a page and report where the person ends up, without fixed sleeps.
 *
 * A guard's redirect() reaches the browser in one of two ways: an HTTP redirect that `goto` simply follows, or, on pages that
 * stream a loading state, a 200 response carrying `<meta id="__next-page-redirect" content="N;url=/target">` that the browser
 * follows a moment later. The marker is in the document once the load event has fired, so after `load` the destination is either
 * the marker's target or the current path. Reading the marker can race with the browser following it; it is retried.
 */
export async function openAndSettle(page: Page, path: string) {
  // The page may fire its own redirect (the meta marker above) before `goto` sees the load event; the browser then reports the first navigation as
  // aborted. That is the redirect happening, not a failure: wait for the page it went to and read where it landed. Any other error still throws.
  let res = null;
  try {
    res = await page.goto(path, { waitUntil: "load" });
  } catch (error) {
    if (!/ERR_ABORTED|interrupted by another navigation/i.test(String(error))) throw error;
    await page.waitForLoadState("load");
  }
  let marker: string | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      marker = await page.evaluate(() => {
        const c = document.querySelector('meta[http-equiv="refresh"]#__next-page-redirect')?.getAttribute("content") ?? "";
        return /url=(.+)$/.exec(c)?.[1] ?? null;
      });
      break;
    } catch {
      await page.waitForLoadState("load"); // the page was navigating under us: the redirect fired; read the new document
    }
  }
  return { status: res?.status() ?? 0, landedOn: marker ?? pathOf(page) };
}

export const pathOf = (page: Page) => new URL(page.url()).pathname;
