/**
 * The public surface of campaign attribution for other modules. Read marketing outcomes through the provider; do not import attribution's internals.
 * See docs/campaign-outcome-provider.md.
 */
export { getCampaignOutcomeProvider } from "./outcome-provider-db";
export {
  CONFIDENCE_DEFAULTS, OUTCOME_CONSUMERS, OUTCOME_DEFINITIONS, OutcomeAccessError, createOutcomeProvider, labelConfidence,
  type CampaignOutcomeProvider, type ConfidenceLabel, type DataAge, type OutcomeCaller, type OutcomeConfidence, type OutcomeConsumer, type OutcomeGrain, type OutcomePeriod,
  type OutcomeQuery, type OutcomeReport, type OutcomeRow, type OutcomeTotals, type SpendAge,
} from "./outcome-provider";
