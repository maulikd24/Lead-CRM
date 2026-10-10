import { keep, other, redact } from "./builders";
import type { EvalCase } from "../types";

/** What may reach the AI vendor: scrubForVendor, and the nudger and reply payloads end to end. All values are synthetic. */
export const VENDOR_CASES: EvalCase[] = [
  ...redact("pii_vendor_scrub", "en", [
    { text: "My PAN is ABCDE1234F.", sensitive: ["ABCDE1234F"] },
    { text: "pan abcde1234f here", sensitive: ["abcde1234f"] },
    { text: "PAN: ABCDE 1234 F", sensitive: ["ABCDE", "1234"] },
    { text: "Aadhaar 2345 6789 0123", sensitive: ["2345", "6789", "0123"] },
    { text: "Aadhaar 234567890123", sensitive: ["234567890123"] },
    { text: "Aadhaar 2345-6789-0123", sensitive: ["2345", "6789", "0123"] },
    { text: "call me on 9876543210", sensitive: ["9876543210"] },
    { text: "call me on +91 98765 43210", sensitive: ["98765", "43210"] },
    { text: "my number is 098765-43210", sensitive: ["98765", "43210"] },
    { text: "reach me at (98765) 43210 please", sensitive: ["98765", "43210"] },
    { text: "phone 98765.43210", sensitive: ["98765", "43210"] },
    { text: "UPI id riya.sharma@okhdfcbank", sensitive: ["riya.sharma", "okhdfcbank"] },
    { text: "pay to riya@ybl", sensitive: ["riya@ybl"] },
    { text: "email riya.sharma@example.com", sensitive: ["riya.sharma", "example.com"] },
    { text: "my DOB is 12/03/1990", sensitive: ["12/03/1990"] },
    { text: "account number 50123456789012", sensitive: ["50123456789012"] },
    { text: "account 5012 3456 7890", sensitive: ["5012", "3456", "7890"] },
    { text: "open https://app.example.com/kyc/status?token=abc123xyz", sensitive: ["abc123xyz", "token="] },
    { text: "see app.example.com/verify?otp=482913&u=42", sensitive: ["482913", "otp="] },
    { text: "OTP is 482913 for login", sensitive: ["482913"] },
  ]),
  ...redact("pii_vendor_scrub", "hinglish", [
    { text: "mera number 9876543210 hai", sensitive: ["9876543210"] },
    { text: "mera PAN ABCDE1234F hai", sensitive: ["ABCDE1234F"] },
    { text: "aadhaar 2345 6789 0123 hai mera", sensitive: ["2345", "6789", "0123"] },
  ]),
  ...redact("pii_vendor_scrub", "hi", [
    { text: "मेरा नंबर ९८७६५४३२१० है", sensitive: ["98765", "९८७६५"] },
    { text: "आधार २३४५ ६७८९ ०१२३", sensitive: ["2345", "६७८९", "0123"] },
    { text: "मेरा पैन ABCDE1234F है", sensitive: ["ABCDE1234F"] },
  ]),
  ...redact("pii_vendor_scrub", "en", [
    { text: "my number is nine eight seven six five four three two one zero", sensitive: ["nine eight seven six"], known: "numbers written out in words are not detected (documented limit of pattern scrubbing)" },
  ]),
  ...keep("pii_vendor_scrub", "en", [
    { text: "I added 5000 yesterday", keep: ["5000"] },
    { text: "my age is 34 and I have 2 accounts", keep: ["34", "2 accounts"] },
    { text: "Rs 25,000 and Rs 1,00,000", keep: ["25,000", "1,00,000"] },
    { text: "please call tomorrow at 5", keep: ["please call tomorrow at 5"] },
    { text: "visit app.example.com for details", keep: ["app.example.com"] },
    { text: "I invested 12 lakh in two funds", keep: ["12 lakh"] },
    { text: "Rs 12500000 is the amount", keep: ["12500000"], known: "any run of six or more digits is redacted, so a large rupee amount written without commas is over-redacted (fail-closed)" },
  ]),
  other("pii_vendor_payload", "en", { expect: "block", kind: "vendor_nudger", name: "Riya Sharma", sensitive: ["Sharma"], note: "surname never sent" }),
  other("pii_vendor_payload", "en", { expect: "block", kind: "vendor_nudger", name: "9876543210", sensitive: ["9876543210"], note: "a phone number used as a profile name" }),
  other("pii_vendor_payload", "en", { expect: "block", kind: "vendor_nudger", name: "riya.sharma@example.com", sensitive: ["riya.sharma", "example.com"], note: "an email used as a profile name" }),
  other("pii_vendor_payload", "en", { expect: "block", kind: "vendor_nudger", name: "WhatsApp User", sensitive: ["WhatsApp"], note: "fallback label as a name" }),
  other("pii_vendor_payload", "en", { expect: "block", kind: "vendor_nudger", name: "Riya Sharma", reason: "PAN ABCDE1234F pending, mobile 9876543210", sensitive: ["ABCDE1234F", "9876543210"], note: "free-text reason never leaves" }),
  other("pii_vendor_payload", "en", { expect: "block", kind: "vendor_reply", name: "Riya Sharma", inbound: ["Hi this is Riya Sharma, my number is 9876543210 and PAN ABCDE1234F"], sensitive: ["Sharma", "9876543210", "ABCDE1234F"], note: "reply excerpt strips surname, phone and PAN" }),
  other("pii_vendor_payload", "hinglish", { expect: "block", kind: "vendor_reply", name: "Riya Sharma", inbound: ["Sharma ji bol raha hoon, mera number 9876543210 hai, status batao"], sensitive: ["Sharma", "9876543210"], note: "honorific after the surname is stripped with it" }),
  other("pii_vendor_payload", "hi", { expect: "block", kind: "vendor_reply", name: "Riya Sharma", inbound: ["मेरा नंबर ९८७६५४३२१० है, आधार २३४५ ६७८९ ०१२३"], sensitive: ["९८७६५", "98765", "६७८९", "6789"], note: "Devanagari digits are mapped before redaction" }),
  other("pii_vendor_payload", "en", { expect: "block", kind: "vendor_reply", name: "Riya Sharma", inbound: ["Check https://kyc.example.com/u/riya?session=s3cr3t9 and tell me"], sensitive: ["s3cr3t9", "session="], note: "link paths and queries can carry tokens" }),
];
