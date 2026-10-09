/** Pure helpers for showing a call transcript: split it into speaker turns, mask personal identifiers, and window long
 *  lists. No I/O, so they are cheap to test. */

export type Speaker = "rm" | "customer" | "unknown";

export type TranscriptTurn = {
  index: number;
  speaker: Speaker;
  /** The label as written in the transcript (e.g. "Speaker 2"); empty when the transcript had none. */
  label: string;
  /** Seconds from the start of the call when the transcript carries a timestamp, else null. */
  startSec: number | null;
  text: string;
};

const RM_LABELS = new Set(["rm", "agent", "advisor", "adviser", "relationship manager", "executive", "representative", "allvest"]);
const CUSTOMER_LABELS = new Set(["customer", "client", "caller", "user", "prospect", "lead"]);
const TS = String.raw`(\d{1,2}(?::\d{2}){1,2})`;
const LABEL = String.raw`([A-Za-z][A-Za-z0-9 ._-]{0,30}?)`;
const LEADING = new RegExp(String.raw`^\s*\[?${TS}\]?\s*[-–]?\s*${LABEL}\s*:\s*(.*)$`);
const TRAILING = new RegExp(String.raw`^\s*${LABEL}\s*[\[(]${TS}[\])]\s*:\s*(.*)$`);
const PLAIN = new RegExp(String.raw`^\s*${LABEL}\s*:\s*(.*)$`);
const GENERIC_SPEAKER = /^(speaker|spk|channel|participant)[ _-]?\d+$/i;

function toSeconds(ts: string): number {
  const parts = ts.split(":").map(Number);
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}

function classify(label: string): Speaker {
  const key = label.trim().toLowerCase();
  if (RM_LABELS.has(key)) return "rm";
  if (CUSTOMER_LABELS.has(key)) return "customer";
  return "unknown";
}

function isKnownLabel(label: string): boolean {
  return classify(label) !== "unknown" || GENERIC_SPEAKER.test(label.trim());
}

export function parseTranscript(raw: string | null | undefined): TranscriptTurn[] {
  const text = (raw ?? "").replace(/\r\n?/g, "\n");
  if (!text.trim()) return [];

  const turns: TranscriptTurn[] = [];
  let current: TranscriptTurn | null = null;

  const push = (speaker: Speaker, label: string, startSec: number | null, body: string) => {
    current = { index: turns.length, speaker, label, startSec, text: body.trim() };
    turns.push(current);
  };

  for (const line of text.split("\n")) {
    if (!line.trim()) {
      current = null; // a blank line ends a turn; following unlabelled text starts a new paragraph turn
      continue;
    }
    let m = LEADING.exec(line);
    if (m) {
      push(classify(m[2]), m[2].trim(), toSeconds(m[1]), m[3]);
      continue;
    }
    m = TRAILING.exec(line);
    if (m) {
      push(classify(m[1]), m[1].trim(), toSeconds(m[2]), m[3]);
      continue;
    }
    m = PLAIN.exec(line);
    if (m && isKnownLabel(m[1])) {
      push(classify(m[1]), m[1].trim(), null, m[2]);
      continue;
    }
    if (current) {
      const turn: TranscriptTurn = current;
      turn.text = `${turn.text} ${line.trim()}`.trim();
    } else {
      push("unknown", "", null, line);
    }
  }
  return turns.filter((t) => t.text.length > 0).map((t, i) => ({ ...t, index: i }));
}

const MASK = "•••";
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const UPI = /[\w.-]{2,}@[a-z]{2,}\b/gi;
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/gi;
const PAN_SPELLED = /\b(?:[A-Z]\s){4}[A-Z]\s(?:\d\s){3}\d\s[A-Z]\b/gi;
const IFSC = /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi;
const LONG_NUMBER = /\+?\d[\d\s().\-]{6,}\d/g;

/** Data minimisation: a transcript can contain spoken phone numbers, e-mail addresses, PAN and account numbers. They
 *  are hidden on screen; the stored transcript is untouched. */
export function maskSensitive(text: string): string {
  return text
    .replace(EMAIL, `${MASK}@${MASK}`)
    .replace(UPI, `${MASK}@${MASK}`)
    .replace(PAN_SPELLED, MASK)
    .replace(PAN, MASK)
    .replace(IFSC, MASK)
    .replace(LONG_NUMBER, (match) => (match.replace(/\D/g, "").length >= 8 ? MASK : match));
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

// ---- windowing ----------------------------------------------------------------------------------------------------

const LINE_HEIGHT = 22;
const ROW_CHROME = 36; // speaker line + vertical padding
const CHARS_PER_LINE = 48; // deliberately low so a row is never shorter than its text

/** Rows are laid out at a conservative estimated height so a long transcript can be windowed without measuring. */
export function estimateTurnHeight(textLength: number): number {
  return ROW_CHROME + Math.max(1, Math.ceil(textLength / CHARS_PER_LINE)) * LINE_HEIGHT;
}

export type WindowInput = { heights: number[]; scrollTop: number; viewport: number; overscan: number };
export type WindowResult = { start: number; end: number; offsetTop: number; totalHeight: number };

export function computeWindow({ heights, scrollTop, viewport, overscan }: WindowInput): WindowResult {
  if (heights.length === 0) return { start: 0, end: 0, offsetTop: 0, totalHeight: 0 };
  const total = heights.reduce((a, b) => a + b, 0);
  const bottom = scrollTop + viewport;
  let acc = 0;
  let first = heights.length - 1;
  let last = heights.length;
  let firstFound = false;
  for (let i = 0; i < heights.length; i++) {
    if (!firstFound && acc + heights[i] > scrollTop) {
      first = i;
      firstFound = true;
    }
    if (acc >= bottom) {
      last = i;
      break;
    }
    acc += heights[i];
  }
  const start = Math.max(0, first - overscan);
  const end = Math.min(heights.length, last + overscan);
  let offsetTop = 0;
  for (let i = 0; i < start; i++) offsetTop += heights[i];
  return { start, end, offsetTop, totalHeight: total };
}
