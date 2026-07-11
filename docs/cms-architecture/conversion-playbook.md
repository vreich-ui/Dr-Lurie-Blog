# Object Conversion Playbook — the exact recipe + known traps

> **Read this before converting any surface to a CMS object.** It exists because
> the 2026-07-09 system-page conversions (privacy/terms/404 + the homepage grid)
> hit every trap below the hard way. Follow the recipe and check the trap table
> and a conversion should complete without a single fix-up pass. Companion to
> [`core-structure.md`](core-structure.md) (the model) — this is the operations
> manual.

## What "converted" means — the definition of done (READ FIRST)

**An object is converted ONLY when an agent can fully manipulate it, within its
permitted scope, through the MCP _and_ Astro renders it.** Rendering from a
committed JSON export is a _milestone, not done_. "Code-correct export" is worth
nothing on its own — the whole point of this project is agent-editable objects.

A conversion is finished when **all five** hold. No half measures; no partial
credit:

1. **Renders.** Astro builds the surface from the object — the four build gates
   in recipe step 7 (`astro check`, `npm test`, `npm run build`, `dist` grep).
2. **Store-backed.** A real record exists in the **production object store**
   (`object_inventory` returns it), created/published through the real verbs —
   **not** merely a git-committed export. A committed export that no store record
   backs is NOT a converted object; it is a rendered stub.
3. **Round-trips.** An agent can perform **every permitted action** on it via MCP
   end-to-end — checkout → patch (each allowed op) → publish → release → see it
   re-render — proven, not assumed.
4. **Contract-complete.** Every action the object's permitted scope allows is
   (a) described in `object_contract`, **and** (b) backed by an actual MCP server
   tool. If a permitted action has no tool or no contract entry, **building that
   is part of the conversion** — the object is not done until it exists.
5. **Recorded.** `object-inventory.md` carries its row, `conversion-map.md`
   carries its status mark, and `state-of-play.md` carries the session entry.
   **No record = not converted**, full stop.

> **Governing rule (Wolf, 2026-07-10):** "convert an object" means exactly the
> above and nothing less. A task that says "convert X" is not complete until X
> passes all five. Rendering-only work must be labelled "rendered, not converted"
> — never "done."

**Current reality check (be honest about it):** as of 2026-07-11,
**twenty-nine objects are converted**: the three navigation objects, all twelve
page objects (home + about + the 8 W1 interior/system pages + page_contact +
page_thank_you), the twelve shared sections under home/about, and the three
templates — all proven end-to-end by credentialed
`scripts/home-conversion-roundtrip.mjs --production --release` runs (store-backed,
every permitted op round-tripped, published, released; the whole page + template
backlog landed in one batched run on 2026-07-11). **No page renders from an
unbacked export anymore — the rendered-stub backlog is empty.** Still TODO: the
`site` / `taxonomy` singletons (W3/W4) and the W5+ hand-coded pages (see
[`object-inventory.md`](object-inventory.md) and `state-of-play.md`).

## The recipe — the conversion factory (proven end-to-end on the home page, 2026-07-10)

The conversion machinery is standing, not per-session. One conversion = **one
seed module + one driver run per environment**. Do it in this order:

1. **Pre-flight.** Read the object's node in
   [`conversion-map.md`](conversion-map.md) (boundaries, dependencies, Wolf's
   priority) and its row in [`object-inventory.md`](object-inventory.md). Read
   `object_contract('<type>')` for the live schema/ops. Branch off `main`.
   Reuse **registered** section types only — never mint a bespoke per-page
   type ([`design-principles.md`](design-principles.md)); if the surface needs
   a shape the palette lacks, add a **reusable** type first (one union member,
   one registry module, one component).
2. **Write the family's SEED MODULE** — `scripts/lib/<family>-seed-data.mjs`,
   exporting `CONVERSION_SEEDS` (ordered: every referenced object BEFORE its
   referrer) and `SEED_SITE`. Follow `page-home-seed-data.mjs` as the
   template. Bodies come from the canonical examples in `core-structure.md`;
   copy converts to allowlist HTML (traps 5–7). If the family has a typed
   fixture (render gate), pin seed ≡ fixture with a test
   (`page-home-seed.test.ts` is the pattern).
3. **Local rehearsal — one command** (after `rm -rf .tmp/ci-test && npx tsc -p
tsconfig.test.json`):
   `node scripts/home-conversion-roundtrip.mjs --local --write-exports --seeds scripts/lib/<family>-seed-data.mjs`
   This runs the ENTIRE lifecycle against an isolated local store: ensure
   (create/heal), EVERY permitted op ending byte-identical, validate, publish
   (**expected to block at `export_commit_failed` — the sandbox success
   signal; do NOT work around it**), contract-completeness, inventory, then
   materializes the derived exports into `src/data/site/`. Revert
   timestamp-only churn on exports of unchanged objects.
4. **Route file** becomes a thin loader:
   `<PageObjectRenderer objectId="page_x" />`. Delete the old source file
   (verify importers first).
5. **Verify RENDER (criterion 1) — all four build gates**: `npx astro check`
   (0 errors), `npm test` (all green), `npm run build` (succeeds), and **grep
   the `dist/` output** for the page's real content. Run
   `scripts/build-diff.mjs` and REVIEW the diff — byte-identical is required
   only for pure cutovers; an intentional flexible-shape diff must be scoped
   to the converted surface and inspected (design-principles rule 4).
6. **Record it (criterion 5), same change**: `object-inventory.md` row +
   `conversion-map.md` status mark + `state-of-play.md` session entry in the
   SAME commit/PR. Status stays **RENDERS** at this point — never claim
   CONVERTED before step 8's run.
7. **Merge + deploy BEFORE the production run.** Commit (one object/family per
   commit), push, PR per the session's instructions. The deployed MCP endpoint
   validates against the schema that is LIVE — running step 8 against
   undeployed schema fails with unrecognized-key errors (the schema-vintage
   gate). Wait for the Netlify deploy of `main` to finish.
8. **Production conversion — the same command, credentialed** (criteria 2+3;
   run from a machine holding `PUBLISH_SECRET`, never paste secrets into
   chats/commits):
   `node scripts/home-conversion-roundtrip.mjs --production --release --seeds scripts/lib/<family>-seed-data.mjs`
   ensure heals/creates the store records, the drill proves every permitted op,
   publish commits the exports (`[skip netlify]`), release fires ONE build and
   confirms `released: true`. Idempotent — safe to re-run. If any permitted
   action has no tool or no `object_contract` entry (criterion 4), **build it —
   that is part of this conversion**, not a follow-up.

   **Batching the whole backlog in one run + one deploy (the pattern).** When
   several families are seeded and awaiting the run, aggregate them into one
   throwaway combined seed module (`scripts/lib/pending-conversion-seeds.mjs`)
   that re-exports the union of each family's `CONVERSION_SEEDS` + a shared
   `SEED_SITE`, and convert them in a single driver invocation — one `--release`
   = one Netlify deploy for everything, instead of one command per family. Wrap
   it with a preflighted one-liner (`scripts/convert-pending-production.sh`:
   require `PUBLISH_SECRET`, run `--verify-only` first for a safe dry check, then
   the real `--production --release`). The driver drills page + template families
   in the same run and proves each template's instantiation with a `dry_run`.
   **Retire the combined module + wrapper once the backlog is empty** (they are
   single-batch tooling) — the 2026-07-11 batch converted 13 objects (8 W1 pages
   + 3 W2.5 templates + 2 W2 form pages) exactly this way and its harness was
   then removed. Recreate a fresh one for the next wave.
9. **Flip the record**: with the all-green run output in hand, flip the
   object's marks to 🟢 CONVERTED (`object-inventory.md`, `conversion-map.md`,
   the reality lines in `CLAUDE.md`/`AGENTS.md`/this file) and log the run in
   `state-of-play.md`. **No record = not converted.**

### Template families (W2.5 — recipes, not rendered surfaces)

The same factory converts `template` objects, with three differences:

- **No route file, no render gate.** Templates materialize to
  `src/data/site/templates/{tpl_id}.json` but render nothing — criterion 1's
  analogue is "**each recipe instantiates** into a page that validates clean
  under its PageType" (pinned offline in `templates-seed.test.ts`).
- **The driver drills the four template ops** (`set_template_meta`,
  `upsert_slot`, `move_slot`, `remove_slot`) via an always-legal probe slot,
  and then proves instantiation with an `object_instantiate_template`
  **`dry_run: true`** call per template — the dry run builds and validates the
  would-be page WITHOUT persisting, so production runs leave no probe pages.
- **Blueprints must be self-contained** (no `shared_ref`s, no content refs, no
  asset refs) so an instantiated page validates with zero external targets;
  required slots may omit the blueprint ONLY when the first allowed type has
  registry `defaultData` (instantiation falls back to it — `tpl_legal` keeps
  that path exercised deliberately). Blueprint section ids are `s_<alnum>`
  (no underscores after `s_`) — same rule as any section instance.

Starter set: `scripts/lib/templates-seed-data.mjs` (`tpl_interior`,
`tpl_landing`, `tpl_legal`).

## Exact call/response field names (do not guess these)

| Call                          | Send                                                                                        | Read from `structuredContent`                            |
| ----------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `object_create`               | `object_type`, `site: 'site_drlurie'`, `body`, `requested_id`                               | `.record` (the full ObjectRecord)                        |
| `object_instantiate_template` | `template_id`, `site`, `route`, `title` (+ `page_type`, `seo`, `requested_id`, `dry_run`)  | `.record` + `.instantiated_from`; dry run: `.body`, `.object_id`, `.id_available`, `.summary` |
| `object_checkout`             | `object_type`, `object_id`                                                                  | `.lockToken` (camelCase), `.record_version`              |
| `object_validate`             | `object_type`, `object_id`, `candidate_patch: [...]` (or `[]`)                              | blockers list on failure                                 |
| `object_patch`                | `lock_token` (snake), `expected_record_version`, `ops`                                      | `.record_version` (new)                                  |
| `object_publish`              | `object_type`, `object_id`, `lock_token`                                                    | sandbox: error `code: 'export_commit_failed'` — expected |
| `object_get`                  | `object_type`, `object_id`                                                                  | `.record.body`, `.record.version` — **not** `.object`    |

## Trap table (symptom → cause → fix)

| #   | Symptom                                                                                                   | Cause                                                                                                                                                      | Fix                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | astro check: `__generated.record_version: Required` (opaque, far from the mistake)                        | Materializer meta passed as camelCase `recordVersion`; `undefined` was silently dropped by JSON.stringify                                                  | Meta is snake_case `{ at, record_version }`. Now ALSO guarded: materialize throws immediately with a named error                                                               |
| 2   | Patch rejected: `Unrecognized key: "cards"` after changing `source.kind`                                  | `update_section_data` **deep-merges** object fields onto the existing value — switching a discriminated-union variant leaves the OLD variant's keys behind | Explicitly set the old variant's keys to `null` in the same `fields` payload (`null` = delete): e.g. `source: { kind: 'query', query: {...}, cards: null, items: null }`       |
| 3   | create/validate blocked: `"X" does not resolve to an existing …`                                          | Reference integrity is store-backed: `shared_ref` targets, `navigationOverrides`, `template.ref` must EXIST in the store being validated against           | In a fresh local store, seed every referenced object first (from its committed export, `__generated` stripped), THEN the object under work                                     |
| 4   | `content_grid manual item "…" does not resolve to an existing content_item` — always, even for real posts | `object-validation-context.ts` deliberately never resolves `content_item` (articles live in a different store) — a known open gap                          | Use a `query` source; manual curation is deferred until the content_item resolver exists (per Wolf, 2026-07-09)                                                                |
| 5   | Build fails: `splitRichTextParagraphs: … content outside top-level <p> blocks`                            | Component rich-text vocabularies differ (see table below)                                                                                                  | Put headings/lists only in `prose`; keep other components' bodies paragraph-only                                                                                               |
| 6   | Rendered page shows literal `` ` `` characters                                                            | The RichText allowlist has **no `code` tag** — markdown backticks survive conversion as visible text                                                       | Strip backticks (or use quotes) when converting markdown to allowlist HTML; grep the body for `` ` `` before shipping                                                          |
| 7   | Inline `_italic_` (or other md syntax) rendered literally                                                 | Hand-rolled md→HTML conversion missed a rule                                                                                                               | After converting, grep the HTML for leftover markdown tokens (`_`, `**`, `[`, `` ` ``) and visually check the dist output                                                      |
| 8   | `object_publish` "fails" in the sandbox                                                                   | No production secrets — by design                                                                                                                          | `export_commit_failed` + `not_configured` = the expected boundary. Materialize + write the export yourself (recipe step 5); production publish is the handoff                  |
| 9   | ~~Homepage seed script resurrects retired content~~ CLOSED 2026-07-10                                     | `scripts/seed-page-home.mjs` used to seed the RETIRED `static` grid variant                                                                                | `static` is gone from the schema (the sanctioned `cards` source of curated cells replaced it) and the seed carries the settled bodies — re-running the seed is safe again      |
| 10  | Reconcile/heal leaves stray fields; healed body fails the byte-identical check                            | Fields ops (`set_page_meta`, `update_section_data`) DEEP-MERGE: keys the target omits survive unless explicitly set to `null` — at EVERY nesting depth     | Never hand-build heal ops — use `scripts/lib/roundtrip-reconcile.mjs` (`diffFieldsForMerge` nulls strays recursively; unit-tested against the real page_home drift)            |
| 11  | `release_to_production` dies with a non-JSON 504 "Inactivity Timeout"                                     | The server polls deploy receipts longer than intermediary gateways keep an idle response open                                                              | Use the driver's `--release` (hook fired once with `timeout_seconds: 15`, then short read-only `force_build:false` polls). The build usually DID fire — confirm, don't re-fire |
| 12  | `--production` run rejects seeds with unrecognized-key/unknown-kind errors                                | The DEPLOYED endpoint validates against the schema live on main — your branch's new fields/variants don't exist there yet (schema-vintage gate)            | Merge + wait for the Netlify deploy of main BEFORE the production run (recipe step 7); never trim the seed to fit the old schema                                               |

## Component rich-text vocabularies

| Component field                                                         | Accepts (top-level)         | Splitter                                            |
| ----------------------------------------------------------------------- | --------------------------- | --------------------------------------------------- |
| `prose.body`                                                            | `p`, `h2`, `h3`, `ul`, `ol` | `splitRichTextBlocks`                               |
| `hero/lede/bio/newsletter_signup/faq(a)/cta_banner/content_grid` bodies | `p` only                    | `splitRichTextParagraphs` (throws on anything else) |

Inline (inside blocks), everywhere: `strong`, `em`, `a href="https://…"`, `br`,
`li` inside lists. **No `code`, no images, no headings above `h2`.**

## Sandbox driver skeleton

> **A standing, runnable driver exists — use it, don't write throwaways:**
> `scripts/home-conversion-roundtrip.mjs --seeds scripts/lib/<family>-seed-data.mjs`
> drives the full lifecycle for ANY page/section family (ensure/heal → every
> permitted op → validate → publish → contract + inventory checks →
> materialize/release) in `--local` and `--production` modes. Its drill probes
> are type-generic (`scripts/lib/roundtrip-drill.mjs` — safe for strict
> body-only shapes like `prose`, not just the home family's fields). Add
> `--verify-only` to re-prove an already-converted family round-trips WITHOUT
> publishing or releasing (no export churn, no build minutes). The skeleton
> below remains only for ad-hoc exploration of a single verb.

```js
// compile first:  rm -rf .tmp/ci-test && npx tsc -p tsconfig.test.json
for (const k of ['NETLIFY', 'NETLIFY_SITE_ID', 'NETLIFY_BLOBS_TOKEN', 'NETLIFY_AUTH_TOKEN', 'SITE_ID'])
  delete process.env[k];
process.env.PUBLISH_SECRET = 'local-drive-secret';
const { handler } = await import(`${REPO}/.tmp/ci-test/netlify/functions/mcp.js`);
const { setLocalBlobsRootForTesting } = await import(`${REPO}/.tmp/ci-test/netlify/lib/local-blobs.js`);
setLocalBlobsRootForTesting(`${REPO}/.tmp/local-drive-blobs`); // isolate; rm -rf between runs
// JSON-RPC: { jsonrpc:'2.0', id:N, method:'tools/call', params:{ name, arguments } }
// → JSON.parse(res.body).result.structuredContent
// finish: materializePage(id, record.body, { at: new Date().toISOString(), record_version: record.version })
```

Clean up `.tmp/ci-test` and `.tmp/local-drive-blobs` before committing.
