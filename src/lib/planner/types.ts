import type { ChannelKey } from "./channels";
import type { PlanStatus } from "./workflow";

/** Plain views the screens render. Dates are yyyy-mm-dd strings so nothing depends on a time zone. */
export type PlanView = {
  id: string;
  code: string;
  title: string;
  audienceId: string;
  audienceKey: string;
  audienceName: string;
  promiseId: string;
  promiseHook: string;
  channel: ChannelKey;
  destinationId: string;
  destinationName: string;
  destinationStatus: string;
  creatorId: string | null;
  budgetInr: number | null;
  startDate: string | null;
  endDate: string | null;
  ownerId: string;
  ownerName: string;
  status: PlanStatus;
  /** Ids of the checklist items that currently fail. */
  failing: string[];
};

export type AudienceView = { id: string; key: string; name: string; archived: boolean };
