# Campaign planner

Flag `NEXT_PUBLIC_PLANNER` (build time, off by default). Admin and Marketing only. Nothing in the planner publishes, sends or spends: a plan that is approved is a recorded intent, and the campaign itself is run in the ad tools.

A campaign is a **promise** shown to an **audience** on a **channel** that lands on a **destination** (an app screen, a landing page or a WhatsApp chat). The tools people land on (calculators, a portfolio check, a goal planner) are built elsewhere: they are only registered here as destinations.

## What is in it

| Piece | What it does |
| --- | --- |
| Audiences | Three are seeded (salaried professionals 25 to 40 in the metros, affluent and HNI at 50 lakh and above, NRIs) and all are editable. Archiving keeps old plans readable. |
| Promise library | Each promise shows its SEBI and ASCI checklist as visible pass or fail items (never one score): no guaranteed returns, no unsuitable advice, no urgency or scarcity, no hype, proof written down, claims listed, disclaimer. A promise that names an investment product must cite the Product Registry; until the registry is on this base that seam fails closed ("needs registry approval") and the plan cannot be sent for review. |
| Destination registry | Name, kind, URL pattern, owner, status (live, planned, off). A destination that is not live yet can be attached but the plan cannot be approved. A scheduled health check (job `planner-destination-health`, through `runJob`) re-checks the pattern and sends one HEAD request to a public https web page; app schemes and WhatsApp links are never called. |
| Creator registry | Short-video creators with a SEBI registration number. A creator without a valid number is blocked from every plan, in the plan rules (not only on the screen). |
| Plan board | Audience rows by channel columns; each cell lists its plans with their status and how many checklist items still fail. |
| Tracked links | UTM naming convention, a campaign code (`CP-XXXXXX`) in every link, a click-to-WhatsApp link with a prefilled message that carries the code, a QR code per link (inline SVG), and a check that no link carries personal data. A person ticks that the links were tested; any change clears it. |
| Copy drafts | Written by a person or drafted by the AI (`planner.copy` purpose through `callModel()`, agent `planner_copy`, draft only). The market-risk disclaimer is added by code, the text passes the shared ad-copy checks (`checkAdCopy`) and the compliance judge, and a different person approves it. An abstain, a block or a failure saves nothing. |
| Routing rules | By city, language, product and audience, first match wins, one fallback. "Test the rules" shows which rule owns a described lead and why every rule matched or not. Owners must be people who work with customers. The lead intake applies the rules to a lead that arrives with a campaign code and records the routing. |
| Funnel estimate | Ranges (90%) from our own history, read only through the `CampaignOutcomeProvider`. Thin history says "not enough data"; a channel the provider does not measure separately says "not measured". |
| Pre-approval checklist | Promise compliant, destination live, tracking links tested, routing owner set, follow-up consent purpose, copy approved, product claims cite the registry, and (short video) creator registered. |
| Calendar and audit | A month view of plans by date; every status change, approval and edit is in the plan's audit trail. |

## Approval

A plan is approved through the canonical approval service (kind `planner-plan`): four-eyes (the person who drafted it cannot approve it), the reader's tick, the checklist re-run at the gate, a note to ask for changes, and an audit entry. Plan state changes emit `campaign.plan.*` events through `emit()`.

## Access

Area `marketing-planner` (view and manage: Admin and Marketing). Area `marketing-planner-registry` (destinations, creators, routing rules): Marketing may read, only an Admin may change. Every page and action goes through `requireMarketing`; there is no private role list.

## Data

No planner table has a foreign key to a customer, so erasure and merge have nothing to add for it (a test pins that). User references are plain ids, as on social posts.
