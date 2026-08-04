# State-of-play entry — 2026-08-04 (W15 S2)

> **Standalone-file note:** this is a `state-of-play.md` entry, authored for
> top-insertion in the rolling log's usual style. It is committed as its own
> file because this branch was pushed through the GitHub contents API, which
> replaces whole files — and `state-of-play.md` (405 KB) exceeds what this
> session's API pushes can safely carry. **Fold this entry into the top of
> `state-of-play.md` (below the header, above the 2026-08-03 entry) in the
> next local commit, then delete this file.** The PR description carries the
> same instruction.

## Session 2026-08-04 (W15 S2 — fleet admin genesis: provisioning completeness + parity audit)

Wolf's W15 mandate: every tenant — current and future — gets the full admin
workspace and canvas editor, not just Dr. Lurie. The surface was already
fleet law; the LAST MILE (shims, rewrites, Identity, ADMIN_EMAILS, blob
stores, pre-wave scaffolds) was tribal knowledge. This session made
admin/editor completeness a **checked property of site genesis**.

**The machinery.** `packages/core/cli/admin-parity.mjs` is the single source
of truth: the canonical 14-rule infra redirect table (pdf/img, `/mcp`, the
nine OAuth-AS rules, `/api/t`, and the S1 single-segment unforced
`/admin/content/:objectId` rewrite — any `/admin/content/*` splat is stale
by definition), the admin-critical env inventory, the store expectations,
and every automatable check. Two consumers:
`scripts/audit-site-admin-parity.mjs` (read-only pass/gap table per tenant —
`--site sites/<slug>`, `--root` for the drlurie deploy, `--all`; exit 1 on
any gap) and `migrate-site --admin-parity [--write]` (retrofit an older
site: adds missing shims/redirect rules/keepalive schedule/reader loaders,
replaces the stale admin splat in netlify.toml AND site.config.ts, never
overwrites an existing file, provably idempotent). The schema half of
migrate-site now lazy-loads its compiled-tree imports so the parity half
runs on a raw checkout. Human-readable inventory with per-requirement
provisioner (scaffold | migrate-site | Netlify console | env):
`docs/cms-architecture/15-fleet-admin-parity.md`.

**Genesis completeness.** `create-site` now: probes **all 12** core blob
stores (the audit caught the probe list covering 8 — `agent-profiles`, the
W9 §4a dedicated-agent store the admin chat resolves profiles from, plus
`opt-ins`/`commerce-events`/`tracking-events` were used by core but never
probed; the list is now CHECKED against the store literals via
`scanCoreBlobStoreNames`); prints an ADMIN WORKSPACE BOOTSTRAP human-gate
checklist (enable Identity → set ADMIN_EMAILS → invite first Owner) with
every plan and run; carries sharpened ADMIN_EMAILS/IDENTITY_URL checklist
rows; and dropped the stale `OPENAI_CHATKIT_WORKFLOW_ID` row (ChatKit
retired T9.24; zero code consumers). The dry-run fixture was regenerated.
The provisioning runbook gained **§3a — the admin human gate**: exact
console steps, marked as the only part of admin bootstrap a CLI cannot do.

**Fleet state, from the audit.** sites/platform: 12/12 automatable checks
PASS. Root drlurie wiring: 12/12 PASS (S1's rewrite fix verified in place;
`verify-article-images` correctly reported as a site-local extra).
sites/fernwell: 1 gap — it predated W14 F11 and was missing all four
`[...blog]` reader route loaders (published articles and their canvas chips
unreachable); repaired in this change via
`migrate-site --site sites/fernwell --admin-parity --write`, re-audit clean,
fernwell build verified green locally (15 pages, zero-article corpus).
`tests/scripts/admin-parity.test.mjs` (13 tests) pins
genesis-parity-by-construction, the degrade→repair→no-op loop,
never-overwrite, and runs the audit against every real tenant on every
`npm test` — the fleet cannot silently drift below admin parity again.

**F14 (found and fixed en route).** `create-site`'s emitted article loader
(`site-reader-route-templates.mjs`, the F11 addition) used the
single-expression form "(async () => await getStaticPathsBlogPost())
satisfies GetStaticPaths" — which makes the Astro compiler's hoist pass drag
the adjacent "const { post } = Astro.props" up to MODULE scope. The compiled
route then throws "Cannot destructure property 'post' of 'Astro.props'" at
import time and fails the ENTIRE build — reproduced on fernwell's
zero-article tree; every fresh scaffold since F11 would have failed its
first build the same way (the F11 session's local builds were recorded
infrastructure-inconclusive, so this never surfaced). All four loader
templates now use the block-body + blank-line shape sites/platform's proven
committed loaders use, with the finding documented at the template site;
fernwell's committed loaders are the fixed templates' output, build-proven.

**Residual human gates (unchanged in kind, now visible per-run):** enabling
Identity, ADMIN_EMAILS/env values, first-Owner invite, and the credentialed
store probe need account authority — the audit prints them as HUMAN rows;
§3a has the clicks.
