/** Lead Source labels written by intake (kept in step with LEAD_SOURCES in src/lib/clients/options.ts). */
export const SOURCE_LABEL = {
  meta: "Meta Ads",
  instagram: "Instagram Ads",
  google: "Google Ads",
  contactForm: "Contact Form",
  website: "Website/Blog Post",
  appSignup: "App Signup",
  organicSignup: "Organic Signup",
} as const;

/** Which label a website form post gets, from its `form` field. */
export function webFormLabel(form: string | undefined): string {
  const f = (form ?? "").trim().toLowerCase();
  if (f.includes("contact")) return SOURCE_LABEL.contactForm;
  // Customers who sign up on their own — in the app, or organically on the website — are customers too, not only paid leads.
  if (f.includes("app")) return SOURCE_LABEL.appSignup;
  if (f.includes("signup") || f.includes("sign-up") || f.includes("organic")) return SOURCE_LABEL.organicSignup;
  return SOURCE_LABEL.website;
}

type FieldMap = Record<string, string>;

const FIELD_ALIASES: Record<string, string[]> = {
  name: ["full_name", "name", "fullname", "your_name"],
  firstName: ["first_name", "firstname"],
  lastName: ["last_name", "lastname"],
  email: ["email", "email_address", "work_email"],
  phone: ["phone_number", "phone", "mobile", "mobile_number", "contact_number", "whatsapp_number"],
  city: ["city", "location", "town"],
  productInterest: ["product", "product_interest", "interested_in", "service"],
};

function pick(fields: FieldMap, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = fields[key];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

/** Normalises a bag of form answers (any provider) into the fields the CRM understands; the rest become notes. */
export function mapFormFields(fields: FieldMap): {
  name?: string;
  email?: string;
  phone?: string;
  city?: string;
  productInterest?: string;
  answers: Record<string, string>;
} {
  const lowered: FieldMap = {};
  for (const [key, value] of Object.entries(fields)) lowered[key.trim().toLowerCase().replace(/[\s-]+/g, "_")] = String(value ?? "");

  const used = new Set<string>();
  const take = (aliases: string[]) => {
    const value = pick(lowered, aliases);
    aliases.forEach((a) => used.add(a));
    return value;
  };

  const first = take(FIELD_ALIASES.firstName);
  const last = take(FIELD_ALIASES.lastName);
  const name = take(FIELD_ALIASES.name) ?? ([first, last].filter(Boolean).join(" ") || undefined);
  const email = take(FIELD_ALIASES.email);
  const phone = take(FIELD_ALIASES.phone);
  const city = take(FIELD_ALIASES.city);
  const productInterest = take(FIELD_ALIASES.productInterest);

  const answers: Record<string, string> = {};
  for (const [key, value] of Object.entries(lowered)) if (!used.has(key) && value.trim()) answers[key] = value.trim();
  return { name, email, phone, city, productInterest, answers };
}
