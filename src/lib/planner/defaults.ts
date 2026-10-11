import type { ChannelKey } from "./channels";

/**
 * The seeded audiences and promises, loaded once by `ensurePlannerDefaults` when a table is empty. All are editable and
 * every promise passes the guardrail checklist (a test keeps it that way). Plain-English profiles for a SEBI-regulated firm:
 * no figures, no outcomes promised.
 */
export type AudienceSeed = { key: string; name: string; description: string; languages: string[]; cities: string[]; channels: ChannelKey[]; tone: string; productFit: string; objections: string; complianceNote: string };

export const DEFAULT_AUDIENCES: AudienceSeed[] = [
  {
    key: "salaried",
    name: "Salaried professionals",
    description: "Salaried people aged 25 to 40 in the metros, with a regular income, a bank app and a payments app they already use daily, and little time for research.",
    languages: ["English", "Hindi", "Marathi", "Kannada", "Tamil"],
    cities: ["Mumbai", "Delhi NCR", "Bengaluru", "Pune", "Hyderabad", "Chennai"],
    channels: ["click_to_whatsapp", "search_ad", "short_video", "email"],
    tone: "Calm, practical and short. Explain in one line what the tool does and how long it takes. No jargon, no pressure.",
    productFit: "Goal planning (retirement, a home, a child's education), starting a monthly investment, tax-saving options during the financial year, a quick check of existing mutual funds.",
    objections: "I do not have time. I do not understand funds. I am scared of losing money. I already invest through another app. Who is behind this?",
    complianceNote: "Educate, do not advise. No return figures, no 'beat the market', no urgency about market moves. Tax messages must name the financial-year deadline as a fact, never as pressure. Risk disclaimer on every piece.",
  },
  {
    key: "affluent_hni",
    name: "Affluent and HNI",
    description: "People and families with investable assets of 50 lakh and above: business owners, senior professionals and families that already hold several accounts and want one clear view.",
    languages: ["English", "Hindi", "Gujarati", "Marathi"],
    cities: ["Mumbai", "Delhi NCR", "Ahmedabad", "Bengaluru", "Chennai", "Kolkata"],
    channels: ["search_ad", "seo_content", "referral_community", "partner", "email"],
    tone: "Respectful, precise and unhurried. Lead with a conversation and a clear process, not a product. No hype, no familiarity.",
    productFit: "A review of existing holdings, a single consolidated view, a conversation with a dedicated relationship manager, estate and goal planning at a process level.",
    objections: "My family office or CA already handles this. I do not want to be sold to. How are you different from my bank? How is my data protected?",
    complianceNote: "Suitability comes first: nothing may read as a recommendation before a proper conversation. No comparison with named competitors and no performance claims. Referral and partner copy must disclose the relationship.",
  },
  {
    key: "nri",
    name: "NRIs",
    description: "Non-resident Indians who earn abroad and want to invest in India, often across time zones, with questions about accounts, documents and taxes before anything else.",
    languages: ["English", "Hindi", "Gujarati", "Malayalam", "Punjabi"],
    cities: ["Dubai", "Abu Dhabi", "Singapore", "London", "New York", "Sydney"],
    channels: ["click_to_whatsapp", "search_ad", "seo_content", "referral_community"],
    tone: "Clear and reassuring about the process. Explain the steps and the documents, in the reader's time zone. Never imply that rules are simple.",
    productFit: "How an NRI account works, which documents are needed, how the money moves, a conversation with a desk that handles NRI accounts.",
    objections: "I do not know which rules apply to me. Is it safe to send money from abroad? What about tax in both countries? Can I do this without visiting India?",
    complianceNote: "Residency, tax and exchange-control statements need compliance sign-off before use; say 'what to know' and point to the official rule, never to an outcome. Check that every channel and offer is permitted for residents of the country targeted. Risk disclaimer on every piece.",
  },
];

export type PromiseSeed = { hook: string; evidence: string; product: string; allowedClaims: string[]; disallowedClaims: string[] };

const BASE_DISALLOWED = ["Guaranteed, assured or risk-free returns", "Any return figure or projection presented as a result", "Telling a person what to buy or sell", "Urgency, countdowns or scarcity"];

export const DEFAULT_PROMISES: PromiseSeed[] = [
  {
    hook: "See if you are on track for retirement",
    evidence: "The retirement planner shows its assumptions before any result and lets the person change them; the result is labelled as an illustration of the inputs entered.",
    product: "Retirement goal planner",
    allowedClaims: ["Takes about a minute", "Free to try", "Shows how the numbers you enter add up", "You can change the assumptions"],
    disallowedClaims: [...BASE_DISALLOWED, "That a person will reach their goal"],
  },
  {
    hook: "Check your mutual fund portfolio in a minute",
    evidence: "The portfolio check reads a statement the person chooses to share, explains what it holds in plain words, and does not recommend any scheme.",
    product: "Portfolio check",
    allowedClaims: ["Takes about a minute", "Explains what you already hold in plain words", "Works from a statement you choose to share"],
    disallowedClaims: [...BASE_DISALLOWED, "Saying a holding is good, bad or should be sold"],
  },
  {
    hook: "Tax-saving options before March",
    evidence: "The page lists the tax-saving routes available in the financial year with their lock-in and the official source for each; the date is the financial year end, stated as a fact.",
    product: "Tax-saving options guide",
    allowedClaims: ["Explains the options available this financial year", "Shows each option's lock-in period", "Links to the official source"],
    disallowedClaims: [...BASE_DISALLOWED, "Saying how much tax will be saved for a person"],
  },
  {
    hook: "Invest from India as an NRI: what to know",
    evidence: "A guide written with the compliance team that lists the account types, the documents needed and the steps, with a pointer to the official rules and a way to talk to the NRI desk.",
    product: "NRI onboarding guide",
    allowedClaims: ["Explains the account types and the documents", "Walks through the steps in order", "Lets you talk to a person who handles NRI accounts"],
    disallowedClaims: [...BASE_DISALLOWED, "Saying that the rules are simple or the same for everyone", "Tax outcomes for a particular person"],
  },
  {
    hook: "Plan a monthly investment around your goals",
    evidence: "The goal planner starts from the goal and the time available, shows the monthly amount that the entered inputs imply, and labels it as an illustration.",
    product: "Goal planner",
    allowedClaims: ["Starts from your goal and your timeline", "Free to try", "You can change every input"],
    disallowedClaims: [...BASE_DISALLOWED, "That a goal will be met"],
  },
];
