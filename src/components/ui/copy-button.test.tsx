import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CopyButton } from "./copy-button";

describe("CopyButton", () => {
  const out = renderToStaticMarkup(<CopyButton value="C-001" label="client code C-001" />);
  it("is a named button with a 44px target and a polite live region", () => {
    expect(out).toContain('aria-label="Copy client code C-001"');
    expect(out).toContain("size-11");
    expect(out).toMatch(/role="status"[^>]*aria-live="polite"/);
  });
});
