import { correctStage } from "@/lib/stage-engine/transitions";
import { registerApproval } from "../registry";

type StageOverridePayload = { clientId: string; toStageId: string; reason: string };

registerApproval<StageOverridePayload>({
  actionType: "STAGE_OVERRIDE",
  entity: "Client",
  canRequest: (actor) => actor.role === "MANAGER",
  canDecide: (actor) => actor.role === "ADMIN",
  apply: async (payload, ctx) => {
    await correctStage(payload.clientId, payload.toStageId, payload.reason, ctx.decidedById);
  },
});
