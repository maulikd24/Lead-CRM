# Repositories and how we work

This repository is the live Allvest Customer OS for our team and demos.

- `private` (chiru-allvest/allvest-customer-os, PRIVATE): the live platform. `main` is what we run and demo. We build and merge here.
- `origin` (maulikd24/Lead-CRM, public upstream): the shared upstream. We do not push to it. Maulik merges what he chooses. We may pull his changes in one direction, from upstream into here, when we choose.

## Rules
- Nothing is pushed to upstream `main` by us. Changes that belong upstream go up as a branch and a pull request for him to merge.
- No customer data, credentials or secrets in the repository. Real customer records never go to test or demo data.
- Every merge into `main` here passes: typecheck, unit tests, lint ratchet, flags check, role e2e, accessibility (axe), and the layout budget.
- Feature flags default off. A flag turns on only after its owner signs off.

## Pulling upstream
```bash
git fetch origin
git log --oneline HEAD..origin/main   # what upstream has that we do not
```
Bring upstream in with a reviewed merge on a branch, then run the gates before it lands on `main`.
