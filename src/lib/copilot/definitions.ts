import { DISENGAGED_AFTER_DAYS } from "./disengagement";
import { UNFUNDED_AFTER_HOURS } from "@/lib/intelligence/segments";
import { DORMANT_AFTER_DAYS } from "@/lib/intelligence/lifecycle";

/** Plain-language meaning of each term on the Co-pilot and Clients lists. Numbers come from the code that applies them, never typed twice. */
export const DEFINITIONS = {
  valueUnlock: `The stage after a customer's KYC is approved and before the account is funded. At ${UNFUNDED_AFTER_HOURS} hours or more here, the customer is flagged "Unfunded after KYC".`,
  owner: "Who should take the next step: RM (the relationship manager), CRM (the central team), AI bot or Support. It is not the same as the assigned RM.",
  when: 'How soon the next step is due: Today, This week, Later, or Trigger-based (only when something happens, such as a payment or a reply).',
  sla: 'The time each onboarding stage is allowed to take. "Due soon" starts at 75% of that time and "Overdue" at 100%. Referral leads are not measured.',
  disengaged: `A live client with no activity, message or note for ${DISENGAGED_AFTER_DAYS} days or more. Customers who stopped trading for ${DORMANT_AFTER_DAYS} days are "Dormant", which is a separate stage.`,
  critical: "Health is Critical when the stage SLA is overdue, there has been no activity for 7 days or more, or the client is much slower than average in the stage.",
  wealth: "Wealth: leads for investment products such as mutual funds, PMS, AIF and bonds.",
  broking: "Broking: leads for a trading and demat account.",
} as const;
