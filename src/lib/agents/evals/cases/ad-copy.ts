import { adCopy } from "./builders";

/**
 * Ad copy: what creative drafts (and, next, the campaign planner and the social drafter) must never publish, and ordinary educational copy that must pass.
 * These run through checkAdCopy(), which extends the agent guardrails, so a gap in either layer shows up here.
 */
export const AD_COPY_CASES = [
  ...adCopy("ad_returns", "en", "block", ["Guaranteed returns on every plan.", "A risk-free way to grow wealth.", "Double your money in three years.", "Assured 12% a year.", "Never lose with our portfolios.", "Your capital is fully protected."], { rule: "guaranteed_returns" }),
  ...adCopy("ad_returns", "hinglish", "block", ["Pakka returns, koi risk nahi.", "Bina risk ke paisa badhao.", "Ek dum safe investment."], { rule: "guaranteed_returns" }),
  ...adCopy("ad_advice", "en", "block", ["Invest now.", "You should buy this fund.", "We would recommend our flexi-cap fund.", "Recommended for you: the growth plan.", "The right time to invest is today."], { rule: "advice" }),
  ...adCopy("ad_advice", "hinglish", "block", ["Invest kijiye aaj hi.", "Paisa lagao aur badhao."], { rule: "advice" }),
  ...adCopy("ad_performance", "en", "block", ["Our strategy delivered 18% returns last year.", "Top-performing PMS in the country.", "We beat the market every year.", "Returns of 15% p.a."], { rule: "performance_claims" }),
  ...adCopy("ad_testimonial", "en", "block", ["\"Best advisor ever\" says Rahul, a happy client.", "Our clients love us: 4.8/5 stars."], { rule: "testimonials" }),
  ...adCopy("ad_pressure", "en", "block", ["Last chance to open an account.", "Only 10 seats left.", "Offer ends tonight.", "Don't miss out."], { rule: "urgency_scarcity" }),
  ...adCopy("ad_pressure", "hinglish", "block", ["Jaldi karein, sirf aaj.", "Aakhri mauka."], { rule: "urgency_scarcity" }),
  ...adCopy("ad_claims", "en", "block", ["India's most trusted wealth platform.", "Get rich quick with insider tips.", "A free gift when you invest.", "Trusted by 50,000 clients."], {}),
  ...adCopy("ad_identifier", "en", "block", ["Call 98765 43210 and quote ABCDE1234F."], { rule: "safety_layer" }),
  ...adCopy("ad_benign", "en", "allow", [
    "Learn how a demat account is opened, step by step.",
    "A 15 minute call to understand your goals. Book a call.",
    "What is an SIP? A short guide to regular investing.",
    "Understand the difference between a PMS and an AIF.",
    "Download our guide to retirement planning basics.",
    "Join our free webinar on how mutual fund fees work.",
  ]),
  ...adCopy("ad_benign", "hinglish", "allow", ["Demat account kaise khulta hai, jaaniye.", "SIP kya hota hai? Ek chhoti guide."]),
];
