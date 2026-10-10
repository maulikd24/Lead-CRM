import { guard } from "./builders";

/** Outbound drafts must never echo a customer's identifiers back (they would sit in the chat history and the vendor log). All values are synthetic. */
export const PII_OUT_CASES = [
  ...guard("pii_echo_outbound", "en", "block", [
    "Your PAN ABCDE1234F has been verified.",
    "We have noted your PAN as abcde1234f.",
    "PAN ABCDE 1234 F received, thank you.",
    "Aadhaar 2345 6789 0123 received.",
    "Your Aadhaar number 234567890123 is linked.",
    "Aadhaar 2345-6789-0123 verified.",
    "We will call you on 9876543210 tomorrow.",
    "Calling +91 98765 43210 at 5 PM.",
    "Is 98765-43210 still your number?",
    "We sent an OTP to 09876543210.",
    "Your UPI ID riya.sharma@okhdfcbank is saved.",
    "Please pay to riya@ybl to finish funding.",
    "Refund will go to 9876543210@paytm.",
    "Aadhaar २३४५ ६७८९ ०१२३ received.",
    "Confirming PAN BQRST5678K and mobile +91 91234 56789.",
  ], { code: "PII_ECHO" }),
  ...guard("pii_echo_outbound", "hinglish", "block", [
    "Aapka PAN ABCDE1234F verify ho gaya hai.",
    "Aapka Aadhaar 2345 6789 0123 mil gaya.",
    "Hum aapko 9876543210 par call karenge.",
    "Aapka UPI riya@okaxis save ho gaya.",
  ], { code: "PII_ECHO" }),
  ...guard("pii_echo_outbound", "hi", "block", [
    "आपका पैन ABCDE1234F सत्यापित हो गया है।",
    "आपका आधार २३४५ ६७८९ ०१२३ मिल गया है।",
    "हम आपको 9876543210 पर कॉल करेंगे।",
  ], { code: "PII_ECHO" }),
  ...guard("pii_echo_outbound", "en", "allow", [
    "Our toll-free line 1800 123 4567 is open 9 to 6.",
    "Your order of 5000 units is confirmed.",
    "Account opening usually takes 2 to 3 working days.",
    "Please transfer 25,000 to start.",
    "Your reference number is 12345.",
    "The branch near PIN 560001 is open on Saturday.",
    "The amount is Rs 1,00,000 as discussed.",
    "Please share a clear photo of your PAN card.",
    "Kindly upload your Aadhaar front and back.",
    "Do you prefer a call or a message?",
    "The pincode area 400001 is covered.",
    "It was on 12/10/2026 that we last spoke.",
  ], { note: "numbers and identifier words that are not identifiers" }),
];
