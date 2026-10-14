import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./contact-actions", () => ({ revealClientContactAction: vi.fn() }));

import { toBrowserContact } from "@/lib/privacy/contact-mask";
import { ContactValue } from "./contact-reveal";

const RAW = { pan: "ABCDE1234F", mobile: "9876543123", email: "asha.rao@example.com", ckycRef: "50012345678901", mobileKey: "9876543123", emailKey: "asha.rao@example.com", freshdeskSyncKey: "9876543123|asha.rao@example.com" };

/** What the page hands to the browser for a customer and each joint holder: the same mapping the page uses. */
function pagePayload() {
  const client = { id: "c1", name: "Synthetic Customer", ...RAW, accountHolders: [{ id: "h1", name: "Synthetic Holder", ...RAW }] };
  const { accountHolders, ...rest } = client;
  return { ...toBrowserContact(rest), accountHolders: accountHolders.map((h) => toBrowserContact(h)) };
}

const RAW_VALUES = ["ABCDE1234F", "9876543123", "asha.rao", "example.com|", "50012345678901", "12345678901"];

describe("masked views never carry the raw contact", () => {
  it("the client JSON sent to the browser has no raw mobile, email or CKYC reference, nor their normalised keys", () => {
    const json = JSON.stringify(pagePayload());
    for (const raw of RAW_VALUES) expect(json).not.toContain(raw);
    expect(json).toContain("+91 ••••• ••123");
    expect(json).toContain("a•••@example.com");
    expect(json).toContain("•••••••901");
    expect(json).toContain("••••••234F");
  });
  it("the rendered HTML for an Admin or the assigned RM (who get a reveal button) is still masked until it is clicked", () => {
    const p = pagePayload();
    const html = renderToStaticMarkup(
      <>
        <ContactValue clientId="c1" field="mobile" masked={p.mobile} canReveal />
        <ContactValue clientId="c1" field="email" masked={p.email} canReveal />
        <ContactValue clientId="c1" field="ckycRef" masked={p.ckycRef} canReveal />
      </>,
    );
    for (const raw of RAW_VALUES) expect(html).not.toContain(raw);
    expect(html).toContain("this is logged");
  });
  it("a viewer who may not reveal gets no reveal button at all", () => {
    const html = renderToStaticMarkup(<ContactValue clientId="c1" field="mobile" masked="+91 ••••• ••123" canReveal={false} />);
    expect(html).not.toContain("<button");
    expect(html).toContain("+91 ••••• ••123");
  });
});
