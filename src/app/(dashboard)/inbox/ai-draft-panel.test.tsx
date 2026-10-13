import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AiDraftView, type AiDraftPhase, type AiDraftViewProps } from "./ai-draft-panel";

// The panel's server actions load the auth stack; the view under test needs none of it.
vi.mock("./draft-actions", () => ({ draftWithAiAction: vi.fn(), requestDraftApprovalAction: vi.fn(), handOverToRmAction: vi.fn() }));

const noop = () => {};
const render = (phase: AiDraftPhase, over: Partial<AiDraftViewProps> = {}) =>
  renderToStaticMarkup(<AiDraftView phase={phase} text={over.text ?? ""} onText={noop} onDraft={noop} onSendForApproval={noop} onHandOver={noop} onDiscard={noop} {...over} />);

describe("AiDraftView", () => {
  it("idle: offers Draft with AI and nothing else", () => {
    const html = render({ kind: "idle" });
    expect(html).toContain("Draft with AI");
    expect(html).not.toContain("Send for approval");
  });

  it("refused: shows the plain-language refusal message and the hand-over button", () => {
    const message = "A sales draft is blocked for this customer: sales topics are set aside on their record.";
    const html = render({ kind: "refused", message, canHandOver: true });
    expect(html).toContain("No draft was made");
    expect(html).toContain(message);
    expect(html).toContain("Hand over to RM");
    expect(html).toContain('role="alert"');
  });

  it("refused without a hand-over offer: shows the message but no hand-over button", () => {
    const html = render({ kind: "refused", message: "This customer has asked not to be contacted, so nothing was drafted.", canHandOver: false });
    expect(html).toContain("asked not to be contacted");
    expect(html).not.toContain("Hand over to RM");
  });

  it("draft: an editable box with the text, a character count and Send for approval (not Send)", () => {
    const body = "Hi Riya, following up on our chat.";
    const html = render({ kind: "draft", source: "template", edited: false }, { text: body });
    expect(html).toContain(body);
    expect(html).toContain(`${body.length}/4096 characters`);
    expect(html).toContain("Send for approval");
    expect(html).toContain("Not sent. It goes for approval first.");
  });

  it("requested: confirms nothing has gone to the customer", () => {
    const html = render({ kind: "requested" });
    expect(html).toContain("Nothing has gone to the customer");
  });

  it("handed over: confirms the RM task was created", () => {
    expect(render({ kind: "handed_over" })).toContain("Handed over to your RM");
  });
});
