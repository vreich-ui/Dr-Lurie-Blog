# Object Conversion Playbook — the exact recipe + known traps

> **Read this before converting any surface to a CMS object.** It exists because
> the 2026-07-09 system-page conversions (privacy/terms/404 + the homepage grid)
> hit every trap below the hard way. Follow the recipe and check the trap table
> and a conversion should complete without a single fix-up pass. Companion to
> [`core-structure.md`](core-structure.md) (the model) — this is the operations
> manual.

## The recipe (converting a page to an object)

1. **Pre-flight.** Read `object_contract('page')` for the live schema/ops. Check
   the surface's row in [`object-inventory.md`](object-inventory.md). Branch off
   `main`. Reuse **registered** section types only — never mint a bespoke
   per-page type ([`design-principles.md`](design-principles.md)).
2. **Build the body** from the canonical examples in `core-structure.md`.
   Convert copy to allowlist HTML (see trap 6/7 — check every component's
   vocabulary and strip markdown artifacts like backticks).
3. **Drive the real MCP handler locally** (sandbox driver skeleton below): the
   full lifecycle `object_create → object_checkout → object_validate →
object_patch → object_publish → object_checkin`, against the local
   file-backed store.
4. **Expect publish to block** at `export_commit_failed` /
   `committer_code: not_configured`. That is the **success signal** in a sandbox
   (everything through validate→materialize ran; only the production git commit
   needs `GITHUB_CONTENT_TOKEN`/`GITHUB_REPOSITORY`). Do NOT work around it.
5. **Materialize the export** with the real `materialize()`/`materializePage()`
   using the record's actual `version`, and write `file.path`/`file.content`.
   Meta is **snake_case**: `{ at: '<ISO>', record_version: <int> }` (guarded at
   runtime since 2026-07-09 — a wrong key now throws immediately).
6. **Route file** becomes a thin loader:
   `<PageObjectRenderer objectId="page_x" />`. Delete the old source file.
7. **Verify — all four gates**: `npx astro check` (0 errors), `npm test` (all
   green), `npm run build` (succeeds), and **grep the `dist/` output** for the
   page's real content (headings, lists, CTAs actually rendered).
8. **Same-change docs**: update the object's row in `object-inventory.md` in the
   SAME commit/PR. (This step was missed on 2026-07-09; don't repeat that.)
9. **Commit discipline**: one object, one commit; revert timestamp-only churn
   (re-materializing an unchanged object bumps only `__generated.at` — don't
   commit that noise on unrelated exports).

## Exact call/response field names (do not guess these)

| Call              | Send                                                           | Read from `structuredContent`                            |
| ----------------- | -------------------------------------------------------------- | -------------------------------------------------------- |
| `object_create`   | `object_type`, `site: 'site_drlurie'`, `body`, `requested_id`  | `.record` (the full ObjectRecord)                        |
| `object_checkout` | `object_type`, `object_id`                                     | `.lockToken` (camelCase), `.record_version`              |
| `object_validate` | `object_type`, `object_id`, `candidate_patch: [...]` (or `[]`) | blockers list on failure                                 |
| `object_patch`    | `lock_token` (snake), `expected_record_version`, `ops`         | `.record_version` (new)                                  |
| `object_publish`  | `object_type`, `object_id`, `lock_token`                       | sandbox: error `code: 'export_commit_failed'` — expected |
| `object_get`      | `object_type`, `object_id`                                     | `.record.body`, `.record.version` — **not** `.object`    |

## Trap table (symptom → cause → fix)

| #   | Symptom                                                                                                   | Cause                                                                                                                                                      | Fix                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | astro check: `__generated.record_version: Required` (opaque, far from the mistake)                        | Materializer meta passed as camelCase `recordVersion`; `undefined` was silently dropped by JSON.stringify                                                  | Meta is snake_case `{ at, record_version }`. Now ALSO guarded: materialize throws immediately with a named error                                                         |
| 2   | Patch rejected: `Unrecognized key: "cards"` after changing `source.kind`                                  | `update_section_data` **deep-merges** object fields onto the existing value — switching a discriminated-union variant leaves the OLD variant's keys behind | Explicitly set the old variant's keys to `null` in the same `fields` payload (`null` = delete): e.g. `source: { kind: 'query', query: {...}, cards: null, items: null }` |
| 3   | create/validate blocked: `"X" does not resolve to an existing …`                                          | Reference integrity is store-backed: `shared_ref` targets, `navigationOverrides`, `template.ref` must EXIST in the store being validated against           | In a fresh local store, seed every referenced object first (from its committed export, `__generated` stripped), THEN the object under work                               |
| 4   | `content_grid manual item "…" does not resolve to an existing content_item` — always, even for real posts | `object-validation-context.ts` deliberately never resolves `content_item` (articles live in a different store) — a known open gap                          | Use a `query` source; manual curation is deferred until the content_item resolver exists (per Wolf, 2026-07-09)                                                          |
| 5   | Build fails: `splitRichTextParagraphs: … content outside top-level <p> blocks`                            | Component rich-text vocabularies differ (see table below)                                                                                                  | Put headings/lists only in `prose`; keep other components' bodies paragraph-only                                                                                         |
| 6   | Rendered page shows literal `` ` `` characters                                                            | The RichText allowlist has **no `code` tag** — markdown backticks survive conversion as visible text                                                       | Strip backticks (or use quotes) when converting markdown to allowlist HTML; grep the body for `` ` `` before shipping                                                    |
| 7   | Inline `_italic_` (or other md syntax) rendered literally                                                 | Hand-rolled md→HTML conversion missed a rule                                                                                                               | After converting, grep the HTML for leftover markdown tokens (`_`, `**`, `[`, `` ` ``) and visually check the dist output                                                |
| 8   | `object_publish` "fails" in the sandbox                                                                   | No production secrets — by design                                                                                                                          | `export_commit_failed` + `not_configured` = the expected boundary. Materialize + write the export yourself (recipe step 5); production publish is the handoff            |
| 9   | Homepage seed script resurrects retired content                                                           | `scripts/seed-page-home.mjs` still seeds the RETIRED `static` grid variant (kept for its pinned tests)                                                     | Never re-run it against a real store; the `static` variant's full retirement is a listed follow-up                                                                       |

## Component rich-text vocabularies

| Component field                                                         | Accepts (top-level)         | Splitter                                            |
| ----------------------------------------------------------------------- | --------------------------- | --------------------------------------------------- |
| `prose.body`                                                            | `p`, `h2`, `h3`, `ul`, `ol` | `splitRichTextBlocks`                               |
| `hero/lede/bio/newsletter_signup/faq(a)/cta_banner/content_grid` bodies | `p` only                    | `splitRichTextParagraphs` (throws on anything else) |

Inline (inside blocks), everywhere: `strong`, `em`, `a href="https://…"`, `br`,
`li` inside lists. **No `code`, no images, no headings above `h2`.**

## Sandbox driver skeleton

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
