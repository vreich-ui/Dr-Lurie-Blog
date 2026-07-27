# 13 — Separation plan: from one monorepo to per-client repos, projects, and domains

**Status: design only (W14 T14.10). The mechanism exists on paper before it is
ever needed — nothing here is built.** V1 ships as a single monorepo with
per-site Netlify projects (see §Current). This doc is the map for the day a
client needs its assets physically separated — its own repository, its own
Netlify account/project, its own domain — without forking the engine.

## Why this is a design, not a task

Wolf's W14 ruling (R1–R8) fixed the architecture: **the core is fleet law, a
client's content and policy are data, never forked code.** The litmus test for
every separation choice below is that same rule — a client may get its own repo
and domain, but it must still run the _same_ `packages/core`, upgraded fleet-wide
from one place. Separation that copies the engine into each client repo is a
fork, and a fork is the thing this whole program exists to prevent.

Separation becomes worth its cost only under real pressure: a client contract
that forbids shared infrastructure, a per-client compliance boundary, a domain/
brand that must own its own deploy history, or a client we're offboarding with
their data. Until one of those bites, the monorepo is strictly cheaper.

## Current (V1) — where we are

- **One repository.** `packages/core/` is the engine + the Astro app shell
  (fleet law). `sites/<client>/` is per-client data + bindings + a thin build
  entry. They join at the `SiteBinding` seam.
- **Per-site Netlify projects, not env-var tenant selection.** Each site is its
  own Netlify project whose **base directory** is `sites/<client>/`, so it reads
  that site's `netlify.toml`, builds that site's entry, and serves that site's
  function shims. Two live tenants today (drluriescience, kugel-platform) + a
  scaffolded third (fernwell).
- **Per-client MCP endpoint over one core implementation.** Every site serves
  its own `/mcp` (`Platform_MCP`, `Dr_Lurie_Science_MCP`, …), auth-gated by its
  own `MCP_HTTP_AUTH_TOKEN`, dispatching to the _same_ core handlers via
  `configureMcp`. Per-client endpoints, one engine.
- **The fleet CI matrix** discovers `sites/*/site.config.ts` and builds every
  site on every core change — the guarantee that a core edit can't silently
  break a tenant.

The only thing NOT yet separated is the physical asset boundary: all clients
share one git repo and (optionally) one Netlify account. That is what this plan
addresses.

## Target — per-client repository distribution

A client repo contains **only** what is that client's: `sites/<client>/`
(config, seeds, bindings, committed exports), its own `netlify.toml`, and a
**pinned dependency on the core package** — never a copy of it.

```
client-repo/
  package.json            → depends on @fleet/core@<version>  (pinned, not vendored)
  sites/<client>/         → this client's data + bindings + build entry
  netlify.toml            → base = repo root; build pulls @fleet/core from the registry
```

### 1. Versioned-core distribution

The engine must ship as a **versioned package**, consumed by pin, so a client
repo upgrades core the same way any project upgrades a dependency:

- Publish `packages/core` as `@fleet/core` to a private registry (npm private
  scope, or GitHub Packages under the fleet org). Semver: **major** = a
  `SiteBinding`/contract break a client must act on; **minor** = new governed
  capability, backward-compatible; **patch** = fixes.
- The app shell ships inside the same package (it already lives under
  `packages/core/app`), so a client repo has no Astro shell of its own to drift.
- A client repo pins `@fleet/core@X.Y.Z`. Fleet-wide upgrade = bump the pin
  across client repos (scripted, §4), not a hand-edit per client.
- **Contract compatibility is the release gate:** `object_contract` output is
  the client-facing API. A core release runs every discovered site's committed
  exports through the head schemas (the existing `schema-migration-gate.mjs`,
  generalized to run against the packaged core) before it can publish.

### 2. Client-repo generation

`create-site` already scaffolds a per-client tree; separation extends it with a
`--repo` mode that emits a **standalone** client repo instead of a folder in the
monorepo:

- Same scaffold (config bundle, seeds, bindings, bootstrap exports), plus a
  `package.json` depending on `@fleet/core@<current>` and a root `netlify.toml`.
- The credentialed half (Netlify project, blob stores, auto-secrets) is
  unchanged — it already targets a specific site id, not a specific repo.
- The account-authority residual is unchanged and stays human (secret custody,
  repo binding, Identity) — the same checklist the monorepo uses, minus the
  base-directory step (a standalone repo builds from its root).
- **Genesis is identical.** The seed drive runs through the client's `/mcp` exactly
  as it does today; nothing about object birth depends on the repo boundary.

### 3. Migration order (monorepo site → standalone client repo)

Ordered so the site is never dark and rollback is always one revert:

1. **Cut the release.** Publish the core version the client will pin; record it.
2. **Generate the client repo** from `sites/<client>/` at that pinned core
   version (a mechanical copy of the tree + the two new files). The client's
   committed exports come along verbatim — the store is untouched.
3. **Point the client's Netlify project at the new repo** (change the repo
   binding + drop the base directory). Same site id → same blob stores → same
   live content; only the build source moves.
4. **One verify deploy** on the new repo; confirm `/admin`, `/mcp`, and a page
   render. The store never moved, so genesis/round-trip need not repeat.
5. **Remove `sites/<client>/` from the monorepo** in a separate commit, only
   after the new repo's deploy is green. The fleet CI matrix stops building it;
   the two remaining tenants are unaffected (proven by the same matrix).

Retirement (offboarding) is the same sequence stopping at step 3 with the repo
handed over, or the T14.9 tenant-removal path (delete project + tree).

### 4. Drift mitigation — the hard part

Separation's real risk is client repos drifting off core. Mitigations, in order
of strength:

- **No vendored core, ever.** A client repo that copies engine files instead of
  pinning the package is the failure mode; a lint/CI check rejects any
  `packages/core` path inside a client repo.
- **Contract snapshot test in each client repo.** The client repo's CI asserts
  its pinned core's `object_contract` matches a committed snapshot — an
  unintended contract change fails the client's build, not production.
- **Fleet upgrade automation.** A scripted pass opens a pin-bump PR against every
  client repo when a new core ships, running that repo's build + contract
  snapshot. Clients upgrade on a cadence, never by hand-editing engine behavior.
- **The registry is the single source of engine truth.** There is exactly one
  published `@fleet/core` per version; a client cannot be "slightly different" —
  it is pinned to a version or it is broken, both visible.
- **Learning stays core-shaped.** Per-client learning (out of scope for V1, a
  design parameter throughout) rides the uniform tool contract, so what an agent
  learns on one client's endpoint transfers through core, not through per-repo
  divergence. Separation must not create per-repo engine variants for learning to
  attach to — the contract is the attachment point.

## What stays the same across the boundary

The `SiteBinding` seam, the governed object store and its verbs, the per-client
`/mcp` endpoint, the auth posture (per-site `MCP_HTTP_AUTH_TOKEN`, fail-closed in
production — W14 F1), the genesis order (navigation → site → rest), and the
uniform tool contract. Separation moves _where the assets live_; it changes
nothing about _how an agent edits a site_. That invariance is the whole point.
