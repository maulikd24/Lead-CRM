import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./contact-actions", () => ({ revealClientContactAction: vi.fn() }));

import { toBrowserContact } from "@/lib/privacy/contact-mask";
import { PanField } from "./pan-field";
import { ContactValue } from "./contact-reveal";

const RAW_PAN = "ABCDE1234F";
const masked = toBrowserContact({ pan: RAW_PAN }).pan;

describe("PAN on the client page", () => {
  it("the edit field carries only the masked PAN and submits nothing until the PAN is revealed", () => {
    const html = renderToStaticMarkup(<PanField clientId="c1" masked={masked} canReveal />);
    expect(html).not.toContain(RAW_PAN);
    expect(html).toContain("••••••234F");
    expect(html).toContain("this is logged");
    expect(html).not.toContain('name="pan"');
  });
  it("a viewer who may not reveal can see the masked PAN but has no way to edit it", () => {
    const html = renderToStaticMarkup(<PanField clientId="c1" masked={masked} canReveal={false} />);
    expect(html).toContain("••••••234F");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<input");
  });
  it("the details card shows the masked PAN with a logged reveal for Admin and the assigned RM only", () => {
    const admin = renderToStaticMarkup(<ContactValue clientId="c1" field="pan" masked={masked} canReveal />);
    const manager = renderToStaticMarkup(<ContactValue clientId="c1" field="pan" masked={masked} canReveal={false} />);
    for (const html of [admin, manager]) { expect(html).not.toContain(RAW_PAN); expect(html).toContain("••••••234F"); }
    expect(admin).toContain("this is logged");
    expect(manager).not.toContain("<button");
  });
});
