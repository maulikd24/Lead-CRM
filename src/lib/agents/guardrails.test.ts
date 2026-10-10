import { describe, expect, it } from "vitest";
import { checkOutbound, needsHandover } from "./guardrails";

describe("checkOutbound", () => {
  it("passes a plain KYC nudge", () => {
    expect(checkOutbound("Hi Riya, your KYC is approved. Would you like help funding your account?")).toEqual({ ok: true });
  });
  it("blocks return promises in English", () => {
    for (const t of ["We offer guaranteed returns", "This is risk free", "double your money in a year", "assured 12% returns"]) {
      const r = checkOutbound(t);
      expect(r.ok).toBe(false);
    }
  });
  it("blocks return promises in Hinglish and Hindi", () => {
    for (const t of ["Isme pakka return milega", "Hum guarantee dete hain", "इसमें गारंटी है"]) {
      expect(checkOutbound(t).ok).toBe(false);
    }
  });
  it("blocks advice and performance claims", () => {
    expect(checkOutbound("You should buy this fund now")).toMatchObject({ ok: false, code: "ADVICE" });
    expect(checkOutbound("It gave 18% returns last year")).toMatchObject({ ok: false, code: "PERFORMANCE_CLAIM" });
  });
  it("blocks empty and oversized text", () => {
    expect(checkOutbound("   ")).toMatchObject({ ok: false, code: "EMPTY" });
    expect(checkOutbound("a".repeat(1001))).toMatchObject({ ok: false, code: "TOO_LONG" });
  });

  // ---- Adversarial extras -------------------------------------------------
  it("is case- and spacing-insensitive for return promises", () => {
    for (const t of [
      "GUARANTEED",
      "Guaranteed returns on this plan",
      "Risk  free investment",
      "risk-free",
      "RISKFREE",
      "Sure   shot profit",
      "sure-shot",
      "100% safe returns",
      "100 %  safe",
      "No risk at all",
      "zero risk",
      "without any risk",
      "Assured returns",
      "guaranteed 12% returns",
      "Double  your   money",
      "TRIPLE YOUR INVESTMENT",
      "fixed returns every month",
    ]) {
      expect(checkOutbound(t), t).toMatchObject({ ok: false, code: "RETURN_PROMISE" });
    }
  });

  it("classifies promised-return amounts as RETURN_PROMISE before PERFORMANCE_CLAIM", () => {
    expect(checkOutbound("assured 12% returns")).toMatchObject({ ok: false, code: "RETURN_PROMISE" });
    expect(checkOutbound("guaranteed 12% returns")).toMatchObject({ ok: false, code: "RETURN_PROMISE" });
  });

  it("blocks Hinglish and Hindi variants", () => {
    for (const t of [
      "Isme PAKKA  return milega",
      "pakka returns",
      "Yeh garanti ke saath hai",
      "100% gaurantee hai",
      "paisa double ho jayega",
      "गारंटी",
      "गारंटीड रिटर्न",
      "गारन्टी है",
      "पक्का रिटर्न मिलेगा",
      "पक्का  रिटर्न",
      "निश्चित रिटर्न",
      "निश्चित रिटर्न्स",
    ]) {
      expect(checkOutbound(t), t).toMatchObject({ ok: false, code: "RETURN_PROMISE" });
    }
  });

  it("blocks advice phrasings", () => {
    for (const t of [
      "You should buy this fund",
      "YOU SHOULD INVEST in this",
      "You must invest today",
      "I recommend this fund",
      "I  Recommend the scheme",
      "You must sell now",
      "must sell",
      "Buy now before it rises",
      "I suggest you buy this",
    ]) {
      expect(checkOutbound(t), t).toMatchObject({ ok: false, code: "ADVICE" });
    }
  });

  it("blocks performance claims", () => {
    for (const t of [
      "12% returns",
      "It gave 18% p.a.",
      "gave 18% p.a. last year",
      "Delivered 14.5 % annually",
      "returned 9% return in 2024",
      "up 22% annual",
    ]) {
      expect(checkOutbound(t), t).toMatchObject({ ok: false, code: "PERFORMANCE_CLAIM" });
    }
  });

  // ---- False-positive protection -----------------------------------------
  it("passes ordinary onboarding text", () => {
    for (const t of [
      "Your KYC is 100% complete",
      "Your profile is 80% complete, please upload your PAN",
      "SIP of ₹5,000 per month is set up",
      "A minimum of ₹10,000 is needed to start",
      "Rest assured, your documents have been received",
      "Please upload a clear photo of your cancelled cheque",
      "Would you like to invest now? I can share the steps to fund your account.",
      "Your relationship manager will call you tomorrow at 11 AM",
      "I recommend completing your KYC first",
    ]) {
      expect(checkOutbound(t), t).toEqual({ ok: true });
    }
  });

  // DELIBERATE decisions, kept strict because this is a hard compliance guard
  // and a false positive only costs a redraft, whereas a false negative is a
  // regulatory breach:
  //  - a bare "guaranteed"/"guarantee" is blocked even about documents;
  //  - "returns are not guaranteed" is blocked too: risk disclaimers must come
  //    from approved templates, not the AI agent's own words;
  //  - "I recommend ..." is blocked wholesale (AI must not recommend).
  it("deliberately blocks bare 'guaranteed' and negated disclaimers", () => {
    expect(checkOutbound("Your documents are guaranteed to stay confidential")).toMatchObject({ ok: false, code: "RETURN_PROMISE" });
    expect(checkOutbound("Returns are not guaranteed")).toMatchObject({ ok: false, code: "RETURN_PROMISE" });
  });
});

describe("needsHandover", () => {
  it("hands over complaints and regulatory words", () => {
    expect(needsHandover("I want to file a complaint with SEBI").handover).toBe(true);
    expect(needsHandover("this is a fraud, refund my money").handover).toBe(true);
    expect(needsHandover("मुझे शिकायत करनी है").handover).toBe(true);
  });
  it("does not hand over ordinary replies", () => {
    expect(needsHandover("ok I will complete KYC tomorrow").handover).toBe(false);
  });

  // ---- Adversarial extras -------------------------------------------------
  it("hands over every trigger word, any case and plural", () => {
    for (const t of [
      "COMPLAINT",
      "I have complaints",
      "I will complain",
      "I'll go to SEBI",
      "sebi scores portal",
      "Fraud!",
      "you people are frauds",
      "This is a scam",
      "I got scammed",
      "you cheated me",
      "I want a refund",
      "refunds please",
      "I want to withdraw my money",
      "withdraw all my funds today",
      "withdrawal request",
      "my lawyer will contact you",
      "I will call the police",
      "going to the ombudsman",
      "धोखा हुआ है",
      "यह धोखाधड़ी है",
      "शिकायत दर्ज करो",
      "पुलिस बुलाऊंगा",
      "मेरा रिफंड चाहिए",
      "meri shikayat hai",
      "mere saath dhokha hua",
    ]) {
      expect(needsHandover(t).handover, t).toBe(true);
    }
  });

  it("reports the matched word as the reason", () => {
    expect(needsHandover("this is a scam")).toEqual({ handover: true, reason: 'customer mentioned "scam"' });
  });

  // DELIBERATE: "withdraw" alone is NOT a trigger (it is common in harmless
  // onboarding talk); only withdrawing money/funds/investment, or the noun
  // "withdrawal", escalates.
  it("does not hand over harmless uses of 'withdraw'", () => {
    expect(needsHandover("I will withdraw the form and resubmit").handover).toBe(false);
    expect(needsHandover("can I withdraw my application for now").handover).toBe(false);
  });

  it("does not hand over normal onboarding replies", () => {
    for (const t of [
      "ok I will complete KYC tomorrow",
      "Sure, sending my PAN now",
      "thanks, how do I fund my account?",
      "ठीक है, कल केवाईसी पूरा करूंगा",
      "",
    ]) {
      expect(needsHandover(t).handover, t).toBe(false);
    }
  });
});

// ---- Fix round 1 -----------------------------------------------------------
describe("checkOutbound: widened lexicons (fix round 1)", () => {
  const BLOCKED: Record<string, string[]> = {
    "Hinglish promises": [
      "koi risk nahi", "risk nahi", "ek dum safe", "bina risk ke", "nuksan nahi hoga", "loss nahi hoga",
      "paisa dugna", "paisa doguna ho jayega", "pakka profit", "pakka munafa", "sure return milega",
      "return milega", "profit hi profit", "zaroor profit hoga", "munafa hoga", "aapko fayda hoga",
    ],
    "Devanagari promises": [
      "पैसा दोगुना", "पैसा डबल", "कोई जोखिम नहीं", "पक्का मुनाफा", "निश्चित मुनाफा", "रिटर्न मिलेगा",
      "15% रिटर्न मिलेगा", "जोखिम मुक्त", "सुरक्षित निवेश", "फायदा होगा", "मुनाफा होगा",
    ],
    "English advice": [
      "I would recommend you invest", "we recommend buying", "I'd recommend our PMS", "I’d recommend our PMS",
      "recommended for you", "best fund for you", "you should consider investing", "go ahead and invest",
      "invest now before it's gone", "this is the right time to invest",
    ],
    "English promises and performance": [
      "you will definitely earn", "this fund has never lost money", "capital protected", "no downside",
      "your money is safe with us", "it is a safe investment", "you can't lose", "you can’t lose", "sure profit",
      "high returns with low risk", "top performing PMS, 25% CAGR", "returns of 18% last year", "15% CAGR",
    ],
    "Hinglish and Hindi advice": [
      "is fund me invest kijiye", "invest kar do", "isme paisa lagao", "kharid lo", "bech do",
      "निवेश कीजिए", "आप निवेश करें", "इसमें पैसा लगाइए", "खरीद लीजिए",
    ],
  };
  for (const [group, phrases] of Object.entries(BLOCKED)) {
    it(`blocks: ${group}`, () => {
      for (const p of phrases) expect(checkOutbound(p).ok, p).toBe(false);
    });
  }
});

describe("checkOutbound: text normalisation (fix round 1)", () => {
  // Known gaps (out of scope, regex-only): Cyrillic/Greek homoglyphs, letter spacing
  // ("g u a r a n t e e"), leetspeak ("gu4rantee"). Add an LLM-judge second layer later.
  it("catches full-width, zero-width, soft-hyphen and spacing obfuscation", () => {
    for (const t of [
      "ｇｕａｒａｎｔｅｅ",
      "ＧＵＡＲＡＮＴＥＥＤ returns",
      "guar​antee",
      "guar‍antee",
      "risk­free",
      "ris⁠k   free",
      "double  your　money",
      "﻿risk free",
    ]) {
      expect(checkOutbound(t).ok, JSON.stringify(t)).toBe(false);
    }
  });
});

describe("checkOutbound: benign corpus must pass (fix round 1)", () => {
  const BENIGN = [
    "Hi Riya, your KYC is almost done. Can I help you finish the last step?",
    "Your documents are safe with us and used only for KYC",
    "Aapka KYC lagbhag complete hai, kya main madad kar sakta hoon?",
    "आपका KYC लगभग पूरा हो गया है, क्या मैं मदद कर सकता हूँ?",
    "Your account is ready; you can add funds when you like",
    "I recommend completing your KYC",
    "Rest assured, we received your documents",
    "Would you like a call back tomorrow?",
    "Please share a clear photo of your PAN card",
    "Aapka account ready hai, jab chahein funds add kar sakte hain",
    "आपका खाता तैयार है, जब चाहें पैसे जमा कर सकते हैं",
    "Your risk profile questionnaire is pending; it takes 2 minutes",
    "Your SIP of ₹5,000 will start on 5 Nov",
    "Your relationship manager Amit will call you at 11 AM",
    "Aapka risk profile form baaki hai, kripya poora karein",
    "आपका जोखिम प्रोफ़ाइल फॉर्म बाकी है, कृपया पूरा करें",
    "Your KYC is 100% complete",
    "The minimum investment amount is ₹10,000",
    "Aapke documents safe hain aur sirf KYC ke liye use honge",
    "आपके दस्तावेज़ सुरक्षित हैं और केवल KYC के लिए उपयोग होंगे",
    "Thanks for sharing the cancelled cheque. We will verify it by evening.",
    "Would you like to invest now? I can share the steps to fund your account.",
  ];
  it("passes every normal onboarding/nudge sentence", () => {
    for (const t of BENIGN) expect(checkOutbound(t), t).toEqual({ ok: true });
  });
});

describe("needsHandover: extra triggers (fix round 1)", () => {
  it("escalates grievance, fake, consumer court, Hindi money-back and cheating", () => {
    for (const t of [
      "I will raise a grievance", "this looks fake", "I will go to consumer court",
      "मेरा पैसा वापस करो", "ये ठगी है", "I want to withdraw my money",
    ]) {
      expect(needsHandover(t).handover, t).toBe(true);
    }
    expect(needsHandover("I will withdraw the form").handover).toBe(false);
  });
});

// ---- Task 12a: realistic phrasings ------------------------------------------
describe("checkOutbound: task 12a phrase coverage", () => {
  const BLOCKED_12A = [
    "Returns are assured", "you will make money", "you'll make good profits", "profits are certain",
    "we promise returns", "Absolutely safe", "Aap invest karein", "isme invest karein", "Aap paisa lagaiye",
    "निवेश करना चाहिए", "Buy this fund today", "I advise you to buy", "consider putting your money in this PMS",
    "Our fund delivered 22% last year", "fund gave 18% last year", "18% annualised", "Your money will grow steadily",
    "पैसा सुरक्षित रहेगा", "best PMS in India", "outperforms the market", "beat the market every year",
    "Ye fund aapke liye best hai",
  ];
  it("blocks every required phrase", () => {
    for (const p of BLOCKED_12A) expect(checkOutbound(p).ok, p).toBe(false);
  });
  it("still passes extra benign nudges", () => {
    for (const t of [
      "Your KYC is 100% complete",
      "SIP of ₹5,000 per month can be set up whenever you like",
      "Please upload a clear photo of your PAN card",
      "We will call you back at 5 pm tomorrow",
    ]) expect(checkOutbound(t), t).toEqual({ ok: true });
  });
});

describe("checkOutbound: Hinglish additions (fix round 1)", () => {
  it("blocks", () => {
    for (const p of ["hum aapko advise karte hain invest karne ka", "aapka paisa surakshit rahega", "paisa safe rahega", "आपका पैसा बढ़ेगा"]) expect(checkOutbound(p).ok, p).toBe(false);
  });
  it("passes neutral safety wording", () => {
    for (const t of ["Your data is safe with us", "Aapka data safe hai"]) expect(checkOutbound(t), t).toEqual({ ok: true });
  });
});

// ---- Eval-harness findings (agent-evals) -----------------------------------
describe("checkOutbound: identifiers are never echoed (PII_ECHO)", () => {
  it("blocks PAN, Aadhaar, mobile numbers and UPI ids (synthetic values)", () => {
    for (const t of [
      "Your PAN ABCDE1234F has been verified.", "PAN noted as abcde1234f", "PAN ABCDE 1234 F received",
      "Aadhaar 2345 6789 0123 received", "Aadhaar 234567890123", "Aadhaar 2345-6789-0123", "Aadhaar २३४५ ६७८९ ०१२३ received",
      "We will call you on 9876543210", "Calling +91 98765 43210 at 5", "Is 98765-43210 still yours?", "OTP sent to 09876543210",
      "Your UPI ID riya.sharma@okhdfcbank is saved", "pay to riya@ybl", "Refund to 9876543210@paytm",
    ]) {
      expect(checkOutbound(t), t).toMatchObject({ ok: false, code: "PII_ECHO" });
    }
  });
  it("lets ordinary numbers and identifier words through", () => {
    for (const t of [
      "Our toll-free line 1800 123 4567 is open 9 to 6.", "Your order of 5000 units is confirmed.", "Please transfer 25,000 to start.",
      "Your reference number is 12345.", "The branch near PIN 560001 is open.", "The amount is Rs 1,00,000 as discussed.",
      "Please share a clear photo of your PAN card.", "Kindly upload your Aadhaar front and back.", "It was on 12/10/2026 that we spoke.",
      "Hello 1234 a",
    ]) {
      expect(checkOutbound(t), t).toEqual({ ok: true });
    }
  });
  it("keeps the earlier code when a promise and an identifier appear together", () => {
    expect(checkOutbound("Guaranteed returns, call 9876543210")).toMatchObject({ ok: false, code: "RETURN_PROMISE" });
  });
});

describe("checkOutbound: promise phrases found by the evals", () => {
  it("blocks", () => {
    for (const t of [
      "Your capital is fully protected.", "Your principal is safe with us.", "Your principal is protected.", "There is no chance of loss in this fund.",
      "No risk of loss here.", "A loss-proof portfolio.", "This is a surefire way to build wealth.",
      "Bilkul safe hai, paisa doob nahi sakta.", "Aapka paisa kabhi nahi doobega.", "Hamesha profit hi milega.",
      "इसमें नुकसान नहीं होगा।", "100% सुरक्षित है यह योजना।", "मुनाफा ही मुनाफा है इसमें।",
    ]) {
      expect(checkOutbound(t), t).toMatchObject({ ok: false, code: "RETURN_PROMISE" });
    }
  });
  it("still passes ordinary uses of the same words", () => {
    for (const t of ["Please keep your principal amount ready for the transfer.", "Our team will protect your data.", "Aapka paisa kal tak account mein aa jayega.", "आपका खाता सुरक्षित है, कृपया पासवर्ड साझा न करें।"]) {
      expect(checkOutbound(t), t).toEqual({ ok: true });
    }
  });
});

describe("needsHandover: escalation wording found by the evals", () => {
  it("escalates", () => {
    for (const t of [
      "I will file an FIR against this company.", "Main FIR karunga aapke khilaaf.", "I am reporting this to the cyber crime cell.",
      "I will tag the regulator on social media.", "I want my money back right now.", "I want to escalate this.",
      "Yeh thagi hai.", "Mujhe apna paisa nikalna hai abhi.", "Consumer forum mein jaunga main.",
      "मैं एफआईआर दर्ज करूंगा।", "मैं उपभोक्ता अदालत जाऊंगा।", "मुझे अपना पैसा निकालना है।",
    ]) {
      expect(needsHandover(t).handover, t).toBe(true);
    }
  });
  it("does not escalate the common Hinglish word 'fir' or routine requests", () => {
    for (const t of ["Fir se bhej dijiye, form khul nahi raha.", "Fir kal baat karte hain.", "Can you send the form again?", "Please send my money-back guarantee form"]) {
      expect(needsHandover(t).handover, t).toBe(false);
    }
  });
});
