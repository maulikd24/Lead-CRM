import { createHash } from "node:crypto";

import type { IntegrationAdapter, SupportTicketData } from "@/lib/integrations/types";
import { parseFreshdeskWebhook } from "@/lib/integrations/adapters/freshdesk";

let mockTicketCounter = 1000;

/** Stable small number from a contact, so the same person always gets the same fake history. */
function seed(value: string): number {
  return parseInt(createHash("sha256").update(value).digest("hex").slice(0, 6), 16);
}

const DAY = 24 * 60 * 60 * 1000;

export const freshdeskMockAdapter: IntegrationAdapter = {
  provider: "freshdesk",

  async configure() {},

  async testConnection() {
    return { ok: true, message: "Mock Freshdesk connection OK (no real account required)" };
  },

  // Mock adapters authenticate nothing; the webhook route refuses them in Production (isProductionRuntime).
  verifySignature() {
    return true;
  },

  // Same parsing as the live adapter, so local/Preview testing exercises the real ticket flow.
  async handleWebhook(payload) {
    return parseFreshdeskWebhook(payload);
  },

  // Deterministic fake history: every contact found by phone/email has three past tickets.
  tickets: {
    async findContactIds({ phones, email }) {
      const key = phones[0] ?? email;
      return key ? [`mock-contact-${seed(key)}`] : [];
    },
    async listTicketsForContact(contactId) {
      const base = seed(contactId) % 900000;
      const statuses = ["Closed", "Resolved", "Open"];
      return statuses.map<SupportTicketData>((status, i) => ({
        externalId: `mock-${base + i}`,
        subject: ["Unable to log in to trading app", "Brokerage charged twice", "Update bank account"][i],
        status,
        priority: i === 1 ? "High" : "Medium",
        channel: ["Email", "Phone", "WhatsApp"][i],
        createdAt: new Date(Date.now() - (120 - i * 50) * DAY),
        updatedAt: new Date(Date.now() - (110 - i * 50) * DAY),
      }));
    },
    ticketUrl() {
      return null;
    },
  },

  actions: {
    async createTicket(client, params) {
      if (!client.email && !client.mobile) return { success: false, error: "The client has no email or phone to raise a Freshdesk ticket for" };
      mockTicketCounter += 1;
      const ticket: SupportTicketData = {
        externalId: `mock-new-${mockTicketCounter}`,
        subject: String(params.subject ?? `Support request for ${client.name}`),
        status: "Open",
        priority: "Low",
        channel: "Portal",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      return {
        success: true,
        data: { ticketId: ticket.externalId, requester: client.email ? "email" : "phone", status: "open", mock: true, ticket },
      };
    },
  },
};
