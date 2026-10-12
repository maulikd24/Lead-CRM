import { describe, expect, it } from "vitest";
import { matchStopKeyword } from "./keywords";

describe("matchStopKeyword: positives", () => {
  it.each([
    "STOP", "stop", "Stop.", "  stop!  ", "STOP ALL", "stop all messages", "unsubscribe", "UNSUBSCRIBE", "Unsubscribe me",
    "please unsubscribe", "opt out", "opt-out", "optout", "stop messaging me", "stop sending messages", "do not contact me",
    "don't contact me", "dont message me", "remove me from the list", "stop 🛑", "STOP please", "pls stop",
    "band karo", "BAND KARO", "band kro", "bandh karo", "message band karo", "msg band karo", "mat bhejo", "mat bhejiye",
    "रोकें", "रोको", "रोक दो", "बंद करो", "बंद करें", "मैसेज बंद करो", "संदेश बंद करें", "सदस्यता रद्द करें",
  ])("matches %j", (text) => {
    expect(matchStopKeyword(text)).toBe(true);
  });
});

describe("matchStopKeyword: negatives (conservative)", () => {
  it.each([
    "", "   ", "hello", "yes", "ok", "thanks", "do not stop my SIP", "don't stop the sip", "please don't stop",
    "stop loss order kab lagega", "set a stop loss", "I want to stop my SIP payment", "can you stop the auto debit",
    "unsubscribe link not working, please help", "what does STOP mean", "bus stop", "non-stop", "stopped",
    "band mat karo", "do not unsubscribe me", "mat roko", "mat rokiye", "मत रोको", "बंद मत करो",
    "my account is band, please check", "KYC band ho gaya", "रोकें नहीं", "stop. I will pay tomorrow",
    "stop? why", "okay stop calling at night and call after 6pm instead",
  ])("does not match %j", (text) => {
    expect(matchStopKeyword(text)).toBe(false);
  });
  it("does not match very long messages even if they start with a keyword", () => {
    expect(matchStopKeyword("stop " + "word ".repeat(40))).toBe(false);
  });
  it("is not fooled by non-string input", () => {
    expect(matchStopKeyword(undefined as unknown as string)).toBe(false);
    expect(matchStopKeyword(null as unknown as string)).toBe(false);
  });
});
