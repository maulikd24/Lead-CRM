import { describe, expect, it } from "vitest";

import { can } from "../can";
import type { PolicyResource } from "../types";

const ROLES = ["ADMIN", "MANAGER", "RM", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "FINANCE", "MARKETING"] as const;
const own: PolicyResource = { type: "client", id: "c1", assignedToId: "rm-1" };
const theirs: PolicyResource = { type: "client", id: "c2", assignedToId: "rm-2" };
const pool: PolicyResource = { type: "client", id: "c3", assignedToId: null };

describe("lead:stage_move_own (the RM-safe board move)", () => {
  it("allows an RM on a lead assigned to them", async () => {
    expect((await can({ id: "rm-1", role: "RM" }, "lead:stage_move_own", own)).effect).toBe("ALLOW");
  });
  it("denies an RM on another RM's lead and on an unassigned lead", async () => {
    expect((await can({ id: "rm-1", role: "RM" }, "lead:stage_move_own", theirs)).effect).toBe("DENY");
    expect((await can({ id: "rm-1", role: "RM" }, "lead:stage_move_own", pool)).effect).toBe("DENY");
  });
  it("denies without a resource", async () => {
    expect((await can({ id: "rm-1", role: "RM" }, "lead:stage_move_own")).effect).toBe("DENY");
  });
  it("denies every role except RM, even on a lead that is theirs (admin and manager keep client:stage_override)", async () => {
    for (const role of ROLES.filter((r) => r !== "RM")) {
      expect((await can({ id: "rm-1", role }, "lead:stage_move_own", own)).effect, role).toBe("DENY");
    }
  });
  it("leaves the admin and manager stage correction exactly as it was", async () => {
    expect((await can({ id: "a", role: "ADMIN" }, "client:stage_override")).effect).toBe("ALLOW");
    expect((await can({ id: "m", role: "MANAGER" }, "client:stage_override")).effect).toBe("REQUIRE_APPROVAL");
    expect((await can({ id: "rm-1", role: "RM" }, "client:stage_override")).effect).toBe("DENY");
  });
});
