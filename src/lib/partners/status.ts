import type { Loaded } from "./load";
import type { Tone } from "./view-models";

export type DataStatus = { key: "native" | "sample" | "not_connected" | "error"; label: string; tone: Tone; hint: string };

/** One plain status for where the numbers on screen come from, and how far to trust them. Pure. */
export function dataStatus(loaded: Loaded<unknown>): DataStatus {
  if (loaded.status === "not_connected") return { key: "not_connected", label: "Not available", tone: "warning", hint: "Sample data is switched off in production. Nothing is shown rather than made-up numbers." };
  if (loaded.status === "error") return { key: "error", label: "Read error", tone: "destructive", hint: "The partner data could not be read. Nothing is guessed." };
  if (loaded.source === "native") return { key: "native", label: "Live from this CRM", tone: "success", hint: "Read straight from the CRM's own earnings records. No outside service is involved." };
  return { key: "sample", label: "Sample data", tone: "warning", hint: "Every name and number is made up. None of it comes from the programme." };
}
