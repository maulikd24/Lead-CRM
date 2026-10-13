// Side-effect-only import: each definitions/* module calls registerApproval() at module load.
// Imported once from the dashboard layout so the registry is populated before any Server Action
// in this app tries to request or decide an approval.
import "./definitions/stage-override";
import "./definitions/erasure-request";
import "./definitions/payout-run-approval";
import "./definitions/commission-adjustment";
import "./definitions/partner-tax-rule";
import "./definitions/partner-override-rule";
import "./definitions/closed-loop-destination";
import "./definitions/consent-policy-change";
import "./definitions/data-export";
import "./definitions/clevertap-push-batch";
import "./definitions/customer-message-draft";
import "./definitions/freshdesk-reply-draft";
