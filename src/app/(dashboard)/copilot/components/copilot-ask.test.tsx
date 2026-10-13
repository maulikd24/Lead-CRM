import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../actions", () => ({ copilotAskAction: vi.fn() }));

import { CopilotAsk, ChatLog, ChatTranscript, chatReducer, INITIAL_CHAT, isSendKey, type ChatState } from "./copilot-ask";
import type { CopilotAskResponse } from "../actions";
import { SUPPORTED_QUESTIONS } from "@/lib/intelligence/ask-intents";

const ANSWER = {
  ok: true as const,
  answer: "2 KYC-approved customers have not funded yet.",
  rows: [],
  customers: [],
  source: "KycRecord (APPROVED) without a FundingRecord or a successful funds-in payment",
  asOf: "2026-10-13T09:30:00.000Z",
};

/** Submit, then answer, through the reducer: the same sequence the component dispatches. */
function ask(state: ChatState, id: number, text: string, response: CopilotAskResponse = ANSWER): ChatState {
  return chatReducer(chatReducer(state, { type: "submit", id, text }), { type: "answer", id, response });
}

describe("Enter and Shift+Enter", () => {
  const key = (k: string, extra: Record<string, unknown> = {}) => ({ key: k, shiftKey: false, ...extra });

  it("Enter sends", () => {
    expect(isSendKey(key("Enter"))).toBe(true);
  });
  it("Shift+Enter is a new line, so it does not send", () => {
    expect(isSendKey({ key: "Enter", shiftKey: true })).toBe(false);
  });
  it("Enter while an IME is composing text does not send", () => {
    expect(isSendKey(key("Enter", { nativeEvent: { isComposing: true } }))).toBe(false);
  });
  it("other keys never send", () => {
    expect(isSendKey(key("a"))).toBe(false);
    expect(isSendKey(key("Escape"))).toBe(false);
  });
});

describe("chatReducer: submit and answer", () => {
  it("a submit records the trimmed question and marks it pending", () => {
    const s = chatReducer(INITIAL_CHAT, { type: "submit", id: 1, text: "  Which KYC customers have not funded?  " });
    expect(s.pendingId).toBe(1);
    expect(s.turns).toEqual([{ key: "q1", role: "user", text: "Which KYC customers have not funded?" }]);
  });

  it("a second question is ignored while one is pending, and a too-short one is ignored", () => {
    const pending = chatReducer(INITIAL_CHAT, { type: "submit", id: 1, text: "Which KYC customers?" });
    expect(chatReducer(pending, { type: "submit", id: 2, text: "Another question here" })).toBe(pending);
    expect(chatReducer(INITIAL_CHAT, { type: "submit", id: 3, text: "hi" })).toBe(INITIAL_CHAT);
  });

  it("the answer for the pending question is appended and clears the pending mark", () => {
    const s = ask(INITIAL_CHAT, 1, "Which KYC customers have not funded?");
    expect(s.pendingId).toBeNull();
    expect(s.turns[1]).toEqual({ key: "a1", role: "assistant", response: ANSWER });
  });

  it("clearing while a question is in flight drops that answer", () => {
    const pending = chatReducer(INITIAL_CHAT, { type: "submit", id: 1, text: "Which KYC customers have not funded?" });
    const cleared = chatReducer(pending, { type: "clear" });
    expect(cleared).toEqual(INITIAL_CHAT);
    expect(chatReducer(cleared, { type: "answer", id: 1, response: ANSWER })).toEqual(INITIAL_CHAT);
  });
});

describe("the chat as rendered", () => {
  it("an answer is inside the polite live region, with its source and as-of time under it", () => {
    const state = ask(INITIAL_CHAT, 1, "Which KYC customers have not funded?");
    const html = renderToStaticMarkup(<ChatLog turns={state.turns} supported={SUPPORTED_QUESTIONS} pending={false} onSuggest={() => {}} />);
    expect(html).toMatch(/^<div role="log" aria-live="polite"/);
    expect(html).toContain("2 KYC-approved customers have not funded yet.");
    expect(html).toContain(`Source: ${ANSWER.source}`);
    expect(html).toContain(`dateTime="${ANSWER.asOf}"`);
  });

  it("the input is labelled and says how Enter and Shift+Enter behave", () => {
    const html = renderToStaticMarkup(<CopilotAsk canAsk supported={SUPPORTED_QUESTIONS} />);
    expect(html).toContain('for="copilot-ask-input"');
    expect(html).toContain('id="copilot-ask-input"');
    expect(html).toContain('aria-describedby="copilot-ask-hint"');
    expect(html).toContain("Enter sends. Shift + Enter adds a new line.");
    expect(html).toContain("Clear conversation");
  });

  it("an RM sees the box disabled and the reason, not an input that can send", () => {
    const html = renderToStaticMarkup(<CopilotAsk canAsk={false} supported={SUPPORTED_QUESTIONS} />);
    expect(html).toContain("Ask is for managers and admins.");
    expect(html).toMatch(/<textarea[^>]*disabled=""/);
  });

  it("an unmatched question with no key shows the supported questions", () => {
    const unsupported = { ok: false as const, reason: "unsupported" as const, message: "That question needs the AI assistant.", supported: SUPPORTED_QUESTIONS };
    const state = ask(INITIAL_CHAT, 1, "Which customers are quiet this month?", unsupported);
    const html = renderToStaticMarkup(<ChatTranscript turns={state.turns} supported={SUPPORTED_QUESTIONS} pending={false} onSuggest={() => {}} />);
    expect(html).toContain("That question needs the AI assistant.");
    for (const q of SUPPORTED_QUESTIONS) expect(html).toContain(q);
  });

  it("with no conversation yet, the chat offers the six questions to start", () => {
    const html = renderToStaticMarkup(<ChatTranscript turns={[]} supported={SUPPORTED_QUESTIONS} pending={false} onSuggest={() => {}} />);
    for (const q of SUPPORTED_QUESTIONS) expect(html).toContain(q);
  });
});
