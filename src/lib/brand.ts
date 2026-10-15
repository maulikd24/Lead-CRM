/**
 * The ONE place the product's on-screen name lives. Every title, logo lockup, login page, email and notification
 * title reads from here, so a rename is a one-line change. Internal identifiers (the npm package, storage keys,
 * database names) deliberately keep their old names: they are not user-visible.
 */
export const BRAND = {
  name: "Allvest",
  subtitle: "Customer OS",
  /** "Allvest Customer OS": the long form for metadata and the install name. */
  full: "Allvest Customer OS",
  description: "Client onboarding and journey management for Allvest",
  /** Open-source credit shown (small) on the About page. */
  credit: "Built on Supportify (open source)",
} as const;

/** "Clients · Allvest": the browser tab title for a page. */
export const pageTitle = (page: string): string => `${page} · ${BRAND.name}`;
