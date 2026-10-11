import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/login/actions", () => ({ loginAction: vi.fn(), ssoLoginAction: vi.fn(), googleLoginAction: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));

import { LoginPanel } from "./login-panel";

const render = (p: Partial<React.ComponentProps<typeof LoginPanel>> = {}) =>
  renderToStaticMarkup(<LoginPanel googleAvailable={false} ssoAvailable={false} showCredentials {...p} />);

describe("LoginPanel", () => {
  it("shows the email and password form and no Google button when Google is not available", () => {
    const html = render();
    expect(html).toContain('id="email"');
    expect(html).toContain('id="password"');
    expect(html).not.toContain("Continue with Google");
    expect(html).toMatch(/<h1>Sign in to Customer OS<\/h1>/);
  });
  it("puts Google first and the password form second when Google is available", () => {
    const html = render({ googleAvailable: true });
    expect(html.indexOf("Continue with Google")).toBeGreaterThan(-1);
    expect(html.indexOf("Continue with Google")).toBeLessThan(html.indexOf('id="email"'));
    expect(html).toContain("or use email and password");
  });
  it("shows the calm ask-an-admin state as an alert, and nothing that says why", () => {
    const html = render({ googleAvailable: true, notice: { tone: "calm", title: "Ask an administrator for access", body: "That account cannot sign in to Customer OS yet." } });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Ask an administrator for access");
    expect(html).not.toMatch(/inactive|unknown user|not found|domain/i);
  });
  it("hides the password form when only single sign-on is allowed", () => {
    const html = render({ ssoAvailable: true, showCredentials: false });
    expect(html).not.toContain('id="email"');
    expect(html).toContain("Sign in with SSO");
  });
  it("carries a same-origin callback through to the Google form only when given", () => {
    expect(render({ googleAvailable: true, callbackUrl: "/clients" })).toContain('value="/clients"');
    expect(render({ googleAvailable: true })).not.toContain('name="callbackUrl"');
  });
});
