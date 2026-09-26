# Simulation and acceptance plan

The owner requested a complete imaginary Discord environment, smoke/end-to-end
verification, inspectable screenshots and a coherent documentation/GitHub handover.
This extends the initial implementation using the existing production boundaries.

## Design

Use real Discord interaction objects and response serialization, the production port,
handler, authorization service, Wardogs HTTP client, PostgreSQL store/migrations and
role-sync sender. Replace only external Discord/Wardogs/website boundaries with local
fixtures and fictitious members. A fresh schema isolates every run; actual PostgreSQL
is required. No fallback to an in-memory repository may claim database acceptance.

Export a sanitized scenario report with actual messages, checks, observed HTTP effects,
audit state and revision metadata. A local read-only browser viewer displays the report
as an explicitly labeled Discord simulation. It never controls a live bot. Screenshots
are actual Chromium captures of this viewer and remain labeled as simulated evidence.

This proves the application path across its boundaries, not Discord Gateway delivery,
official Discord rendering, an installed Wardogs build or the production web receiver.
Those separately scoped live acceptance issues remain open.

## Delivery sequence

1. Extract the existing Discord port without changing behavior; test real serialized
   interactions against local fixtures and dedicated PostgreSQL.
2. Cover normal Czech/English commands, all six mutations, cancellation/expiry,
   actor/guild/role denial and revocation, duplicate confirmation, ambiguous writes,
   dependency/audit failure, signed membership/departure delivery and persisted interrupted-state recovery.
3. Add `lab:run`, `lab:serve`, `test:e2e` and browser smoke/capture commands. Render
   only the generated report using safe text nodes; maintain keyboard/mobile access.
4. Capture overview, successful confirmation, denial/unknown outcome, role sync and
   mobile layouts. Commit selected captures with captions, hashes and source provenance;
   CI retains full current-run reports, screenshots and failure traces.
5. Consolidate the user guide, testing guide, troubleshooting and documentation index.
   Reconcile actual CLI behavior with every example.
6. Independently review scenarios and proof, run all source/DB/browser/container gates,
   update PR/issues with accessible evidence and complete the authorized Git delivery.

## Acceptance

Every simulated scenario must assert observable application effects, not a mock's
existence. A broken permission, duplicate claim, safe outcome or signing contract must
fail its scenario. Missing database/report/browser prerequisites fail explicitly.
Screenshot metadata distinguishes captured source revision from later documentation
commits; generated proof must not make a dirty revision appear clean. Production secrets
and external addresses are neither required nor copied into the public evidence.
