import { describe, expect, it } from "vitest";
import { assertLocalDatabase } from "./local-db-guard";

describe("assertLocalDatabase", () => {
  it("allows localhost and loopback", () => {
    expect(() => assertLocalDatabase("postgresql://u:p@localhost:5432/db")).not.toThrow();
    expect(() => assertLocalDatabase("postgresql://u:p@127.0.0.1:55432/db")).not.toThrow();
    expect(() => assertLocalDatabase("postgresql://u:p@[::1]:5432/db")).not.toThrow();
  });
  it("rejects hosted databases", () => {
    expect(() => assertLocalDatabase("postgresql://u:p@ep-x.neon.tech/db")).toThrow(/non-local/i);
  });
  it("rejects lookalike hosts", () => {
    expect(() => assertLocalDatabase("postgresql://u:p@localhost.evil.com/db")).toThrow(/non-local/i);
    expect(() => assertLocalDatabase("postgres://localhost@evil.com/db")).toThrow(/non-local/i);
  });
  it("rejects unset or invalid values", () => {
    expect(() => assertLocalDatabase(undefined)).toThrow(/not set/i);
    expect(() => assertLocalDatabase("not a url")).toThrow(/not a valid url/i);
  });
  it("accepts mixed-case localhost", () => {
    expect(() => assertLocalDatabase("postgresql://u:p@LOCALHOST:5432/db")).not.toThrow();
    expect(() => assertLocalDatabase("postgresql://u:p@Localhost/db")).not.toThrow();
  });
  it("rejects a trailing-dot localhost", () => {
    expect(() => assertLocalDatabase("postgresql://u:p@localhost./db")).toThrow(/non-local/i);
  });
  it("rejects host, hostaddr and service query overrides (any case)", () => {
    for (const q of ["host=evil.com", "hostaddr=1.2.3.4", "service=prod", "HOST=evil.com", "HostAddr=1.2.3.4", "Service=prod"]) {
      expect(() => assertLocalDatabase(`postgresql://u:p@localhost/db?${q}`)).toThrow(/unsupported|non-local/i);
    }
  });
  it("rejects empty-host socket URLs with a readable message", () => {
    const run = () => assertLocalDatabase("postgresql:///db?host=/var/run/postgresql");
    expect(run).toThrow(/unsupported|non-local/i);
    expect(run).not.toThrow(/\(\)/);
  });
});
