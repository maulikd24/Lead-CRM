/**
 * Token prices for the cost ESTIMATE on every run. These are approximate list prices in USD per million tokens, kept in code so
 * a change is reviewed; they are not an invoice and must be re-checked against the vendor's price page when a model changes.
 * An unknown model is priced at FALLBACK_PRICE (deliberately high) and the run is still counted, so a new model can never
 * slip past a budget by being unpriced.
 */
export type Price = { inPerM: number; outPerM: number };

const TABLE: Record<string, Price> = {
  "claude-sonnet-5-5": { inPerM: 3, outPerM: 15 },
  "gpt-4o-mini": { inPerM: 0.15, outPerM: 0.6 },
  fake: { inPerM: 0, outPerM: 0 },
};

export const FALLBACK_PRICE: Price = { inPerM: 15, outPerM: 75 };

export function priceFor(model: string): { price: Price; known: boolean } {
  const price = TABLE[model];
  return price ? { price, known: true } : { price: FALLBACK_PRICE, known: false };
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const { price } = priceFor(model);
  return (inputTokens * price.inPerM + outputTokens * price.outPerM) / 1_000_000;
}

/** A rough token count for text we have not sent yet (about 4 characters a token). Used only for the pre-call budget check. */
export const approxTokens = (chars: number) => Math.ceil(chars / 4);
