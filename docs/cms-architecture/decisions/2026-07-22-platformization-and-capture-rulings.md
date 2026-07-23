# Decision record — Platformization (W11) & site-capture (W12) rulings

- **Date:** 2026-07-22
- **Author of record:** propagated from Wolf's rulings (this session is the
  transcription; Wolf is the decision authority)
- **Status:** RATIFIED — do not re-open; cite this record.
- **Governs:** `docs/cms-architecture/11-platformization-plan.md` §6 open
  questions (fills the ANSWER/RATIFIED lines), §3.2 (supersedes the old
  authorization-rule text), and the `cms-pipeline/T11.*` + `T12.*` briefs.
- **Relationship to T11.0:** this record IS the artifact T11.0
  (platform-rulings checkpoint) was to produce; it was not committed at the
  time, so it is created here as the citable authority the propagation needs.
  T11.0's other gate (verify T9.24 legacy deletion actually landed) is
  unchanged and still owned by T11.0.

## Context

W11 reshapes the whole repo into `packages/core` + `sites/<client>` and W12
adds the agent-driven site-capture pipeline. Both waves gated on Wolf's
answers to the §6 open questions. The answers below are ratified as of
2026-07-22. The W10 (design-vocabulary) open questions are NOT in this
record — they are governed by the earlier T10.4 ratification, and OQ-W10-3
(composite) remains open in `composite-sections-decision.md`.

## Rulings

### OQ-W11-1 — Repo strategy → **monorepo**

One monorepo: `packages/core` (law + machinery, fleet-updated) +
`sites/<client>` (data + bindings only), as recommended in §2.2. Rejected:
template-repo + per-client forks. Deferred: publishing core as versioned npm
packages (the graduation path, not the start).

### OQ-W11-2 — Content exports location → **per-client dirs in the monorepo (v1)**

Committed exports and seeds live under `sites/<client>/` in the same
monorepo, as recommended. Per-client content repos are a later graduation,
not v1.

### OQ-W11-3 — Admin console → **per-site admin (v1)**

Each site runs its own admin surface (matches "the system is site-wide").
One-console-over-many-sites is a new auth architecture and is deferred.

### OQ-W11-4 — Tenant boundary → **one Netlify site per client**

The tenant boundary is one Netlify site per client: per-client stores,
credentials, deploys, MCP endpoint, and blast radius. No key-namespacing
inside one store; no shared credential surface across clients.

### OQ-W11-5 — OQ-3 scope → **minimal per-agent-credential slice in T11.10**

The minimal verifiable-per-agent-token slice is in scope for T11.10 (not a
separate wave). At fleet scale, self-declared `agent_name` over one shared
key stops being acceptable. Scope stays minimal — verifiable tokens, not a
full IAM.

### OQ-W11-6 — `mcp/save-json-blob-mcp/` disposition (NEW) → **retire with the legacy pipeline; NOT extracted into `packages/core`**

`mcp/save-json-blob-mcp/` is retired together with the legacy article
pipeline (the T9.22/T9.24 line of work) — it is **not** carried into
`packages/core`. **Importer check first:** before deletion, confirm nothing
still in scope imports it; if a live importer remains, that coupling is
surfaced, not silently broken. Extraction tasks (T11.2–T11.4) must not pull
this module into the core; the de-hardcode/relocation work (T11.5–T11.6)
treats it as legacy-bound, like `publish-article.ts`.

### Lint exit-bar carve-out (RATIFIED)

The zero-`drlurie` lint rule that guards `packages/core/**` (T11.5) applies
to **application code only**. `tests/` fixtures are **EXEMPT** for v1 —
parameterizing test fixtures away from `drlurie` is explicitly **deferred**.
The exit criterion "zero `drlurie` literals in core (lint-enforced)"
(§8/W11) reads against application code; fixtures are out of the lint's
scope for v1.

### OQ-W12-1 — Capture authorization → **PER-PROJECT and CONTRACT-OWNED** (overrides the §3.2 recommendation)

Capture authorization is **not a global rule** baked into the pipeline. The
model's own hard refusals are the **sole universal floor**. Every other
limit — what may be captured, from where, and what may be done with it — is
a **setting the target client repo owns** and surfaces through **its MCP
contract**. The capture pipeline **reads those contract-declared bounds and
stays inside them**; it carries **no built-in ownership precondition** and
no global "owned/licensed/authorized targets only" gate. This SUPERSEDES the
§3.2 "Authorization rule (blocking precondition in every T12 brief)" text.

**Implementation consequence (seam the pipeline reads):** CMS-Agent's
project registry needs a **per-project governance/limits block** beside the
existing `contentContract` / `toolPolicies` / `publishingPolicy`. Each
client declares its settings via its MCP contract
(`registry_get` / `object_contract`), and the pipeline reads that block to
learn the bounds it must honor. (Tracked in plan §3 + T12.1.)

### OQ-W12-2 — Fidelity bar → **coverage-based default, per-project overridable**

The default "reasonable limits" bar is coverage-based — section-mapping
coverage ≥ 90%, token extraction complete, layout gaps enumerated in the
report (NOT a pixel threshold). It is a **default** each project may
**override** through its own settings (same contract-owned seam as
OQ-W12-1).

### OQ-W12-3 — Landing zone → **never-released drafts in the target project's own store; T12.1 spike local**

Captures land as **never-released drafts in the target project's own
store** (the staging client from T11.11 when W11 is in place; otherwise the
target project's store directly — not a Dr-Lurie-only fallback). The T12.1
capture spike runs **locally** (no store writes at all). Nothing
auto-publishes; nothing releases.

## Consequences — documents updated in this record's propagation

- `11-platformization-plan.md` §6 — ANSWER/RATIFIED lines filled; OQ-W11-6
  added; §3 implementation-consequence pointer; §3.2 old authorization rule
  annotated SUPERSEDED.
- `cms-pipeline/T11.5-desite-hardcodes.md` — 2026-07-22 census folded into
  the target list; front-loaded items marked; lint carve-out subsection;
  OQ-W11-6 recorded.
- `cms-pipeline/T11.7-provisioning-cli.md` — real per-site env table.
- `cms-pipeline/T12.1…T12.6` — authorization language rewritten to the
  per-project/contract-owned model; OQ-W12-2/-3 reflected.
- `cms-pipeline/state-of-play.md` — session entry.
