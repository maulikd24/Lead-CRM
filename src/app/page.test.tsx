import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/config", () => ({ auth }));
vi.mock("@/lib/auth/google/available", () => ({ googleSignInAvailable: vi.fn(async () => false) }));
vi.mock("@/lib/front-door/trust-wiring", () => ({ trustStripSignedOff: vi.fn(async () => false) }));
vi.mock("@/components/front-door/landing", () => ({ Landing: () => null }));

import Home from "./page";
import { landingFor } from "@/lib/policy/workspace";

const go = async () => {
  try {
    return { element: await Home(), to: null as string | null };
  } catch (e) {
    return { element: null, to: String((e as Error).message).replace("REDIRECT:", "") };
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_LANDING;
});

describe("the root page", () => {
  it("flag off, signed out: sends the visitor to /login exactly as before", async () => {
    auth.mockResolvedValue(null);
    expect((await go()).to).toBe("/login");
  });
  it("flag off, signed in: sends each role to its own landing screen", async () => {
    for (const role of ["ADMIN", "MANAGER", "RM", "MARKETING", "FINANCE", "PARTNER", "DEALER"] as const) {
      auth.mockResolvedValue({ user: { role } });
      expect((await go()).to).toBe(landingFor(role));
    }
  });
  it("flag on, signed in: still goes straight to the landing screen, never the front door", async () => {
    process.env.NEXT_PUBLIC_LANDING = "1";
    for (const role of ["ADMIN", "RM", "MARKETING"] as const) {
      auth.mockResolvedValue({ user: { role } });
      expect((await go()).to).toBe(landingFor(role));
    }
  });
  it("flag on, signed out: shows the front door instead of redirecting", async () => {
    process.env.NEXT_PUBLIC_LANDING = "1";
    auth.mockResolvedValue(null);
    const r = await go();
    expect(r.to).toBeNull();
    expect(r.element).not.toBeNull();
  });
  it("only the exact value 1 turns the front door on", async () => {
    auth.mockResolvedValue(null);
    for (const v of ["true", "0", "yes", ""]) {
      process.env.NEXT_PUBLIC_LANDING = v;
      expect((await go()).to).toBe("/login");
    }
  });
});
