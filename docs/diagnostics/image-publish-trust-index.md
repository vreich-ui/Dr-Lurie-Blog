# Diagnosis: the image-publish trust-index split

**Status:** diagnostic only — no application code was changed by this document.
**Date:** 2026-07-02
**Scope read:** `netlify/functions/mcp.ts`, `netlify/functions/save-json-blob.ts`,
`netlify/functions/admin-patch-workflow.ts`, `netlify/lib/artifact-index.ts`,
`netlify/functions/save-artifact.ts`, `docs/agents/pdf-tool-artifacts.md`.
The `pdf-tool` repository was **not** readable from this environment (GitHub access
is scoped to `vreich-ui/dr-lurie-blog` only); its behavior is characterized from the
task's anchor and from `docs/agents/pdf-tool-artifacts.md`. See §6.

---

## TL;DR

The hypothesis is **CONFIRMED**. Two code paths judge whether an image artifact is
"valid," and they read **two different, unreconciled stores**:

| Path | Function (anchor) | Source of truth |
| --- | --- | --- |
| **Pre-publish validator** (staging / patching) | `gatherTrustedArtifactRefs` — `save-json-blob.ts:1559` | `record.agent_outputs[*].output.artifactReferences[].blobKey` (a field **inside the workflow record**). Never touches the artifact index. |
| **Publish-time resolver** (what actually ships) | `getArtifactReferencesForRequest` — `mcp.ts:2530` | the **artifact-index blob store**, prefixes `by-request/<requestId>/` (pointers) with a fallback to `request-artifacts/<requestId>/`. Never reads `agent_outputs`. |

An image lives in the artifact index the moment it is created, but does **not** live
in `agent_outputs` until an agent explicitly copies its `ArtifactReference` there via
`<agentName>_update_output`. Nothing performs that copy automatically. So an agent can
`list_artifacts_for_request` an image (index sees it) and then be rejected by
`patch_canonical_input` for the *same* image (agent_outputs does not see it).

Two of the task's anchor descriptions need small corrections — see the ⚠ notes in
§1 and §2.

---

## 1. Are the two sources of truth different? (CONFIRMED)

### Pre-publish validator — reads the workflow record only

`save-json-blob.ts:1558-1577`:

```ts
/** Collect every blobKey from every agent_output.artifactReferences array. */
const gatherTrustedArtifactRefs = (record: WorkflowRecord): Set<string> => {
  const refs = new Set<string>();
  for (const agentOutput of Object.values(record.agent_outputs)) {
    if (!agentOutput) continue;
    const out = agentOutput.output;
    if (!isRecord(out)) continue;
    const artifactRefs = out.artifactReferences;
    if (!Array.isArray(artifactRefs)) continue;
    for (const ref of artifactRefs) {
      if (isRecord(ref) && typeof ref.blobKey === 'string' && MAJOR_KEY_ARTIFACT_REF_RE.test(ref.blobKey)) {
        refs.add(ref.blobKey);
      }
    }
  }
  return refs;
};
```

- **Exact source:** the in-record path `record.agent_outputs[<any agent>].output.artifactReferences[*].blobKey`.
- **No blob store is opened.** There is no call to `getArtifactIndexBlobStore`, no
  `by-request/` or `request-artifacts/` listing anywhere in this function or its callers.
- The returned `Set<string>` is the exclusive allow-list for every image the agent may
  reference during staging (see §4).

The rejection message is explicit about the source — `save-json-blob.ts:1680-1682`:

```
`${path} "${value}" is not found in agent_outputs artifact indexes for this record.
 Only artifact references already saved in agent_outputs are accepted.`
```

### Publish-time resolver — reads the artifact-index blob store only

`mcp.ts:2530-2546`:

```ts
const getArtifactReferencesForRequest = async (event, requestId): Promise<ArtifactReference[]> => {
  const store = (await _mcpInternal.getArtifactIndexBlobStore(event)) as unknown as ArtifactIndexStore;
  const pointerPrefix = `by-request/${encodeURIComponent(requestId)}/`;
  const pointerKeys = await listArtifactIndexKeys(store, pointerPrefix);

  const artifacts = pointerKeys.length
    ? await Promise.all(pointerKeys.map(async (key) => resolveArtifactPointer(store, await parseJsonBlob(store, key))))
    : await Promise.all(
        (await listArtifactIndexKeys(store, `request-artifacts/${encodeURIComponent(requestId)}/`)).map((key) =>
          parseJsonBlob(store, key)
        )
      );

  return artifacts.filter(
    (artifact): artifact is ArtifactReference => artifact !== undefined && !isDeletedArtifactReference(artifact)
  );
};
```

- **Exact source:** the `artifact-index` blob store (`getArtifactIndexBlobStore`), listing
  `by-request/<requestId>/` pointer objects first, and falling back to the full
  `request-artifacts/<requestId>/` reference objects when no pointers exist.
- **No `agent_outputs` is read.**

`listArtifactsForRequest` (`mcp.ts:2548-2561`) — the tool an agent calls to "see" images —
delegates straight to this resolver:

```ts
const artifacts = await getArtifactReferencesForRequest(event, requestIdValidation.value);
return toolResult({ artifacts });
```

Anchor descriptions in the task for both functions are **accurate**.

> ⚠ **Correction to one anchor.** The task calls the cross-request resolution in
> `buildCanonicalPublishPayload` (`mcp.ts:1834-1851`) a hit against "the real store."
> It is the **artifact-index** store (`getArtifactIndexBlobStore`, `mcp.ts:1834`) resolved
> via `readArtifactReference` (which reads the `request-artifacts/<requestId>/<sha>.json`
> reference JSON), **not** the artifact-bytes store (`getArtifactBlobStore`). This matters:
> even the cross-request fallback is trusting the *index*, never `agent_outputs`.

**Conclusion:** the two paths use two disjoint sources. The split is real and exactly as
hypothesized.

---

## 2. Full lifecycle of one image `blobKey` (creation → successful publish)

Take one image whose `blobKey` is `image/<requestId>/<sha256>.png`.

1. **Creation (bytes + index).** The image is finalized by
   `finalizeUpload` (`save-artifact.ts:363-405`). It writes the bytes to the artifact
   blob store and then calls `writeArtifactReferenceIndexes` (`artifact-index.ts:50-76`),
   which writes:
   - the reference JSON at `request-artifacts/<requestId>/<sha256>.json`
     (`requestArtifactReferenceKey`, `artifact-index.ts:20-22`),
   - the request pointer at `by-request/<requestId>/<kind>/<sha256>.json`
     (`artifactRequestPointerKey`, `artifact-index.ts:38-41`),
   - plus `by-kind/` and `by-tag/` pointers.

   > ⚠ **Where `pdf-tool` fits (partly unverifiable — see §6).** Per
   > `docs/agents/pdf-tool-artifacts.md`, `pdf-tool` is the artifact-generation service and
   > returns a "Dr. Lurie-native `ArtifactReference`." For `list_artifacts_for_request` to
   > later show the image (§1 proves list reads the index), the reference **must** end up in
   > Dr. Lurie's `artifact-index` store — i.e. `pdf-tool` (or the agent, via
   > `save-artifact`/`artifact-upload`) has to perform a write equivalent to step 1. The
   > task's `getAgentArtifactJobStatus` returns `workflowPatchStatus: "skipped_by_design"`;
   > `docs/agents/pdf-tool-artifacts.md:20-21,64-66` corroborate that `pdf-tool` returns the
   > reference and the **agent** is responsible for inserting it into the workflow JSON. So
   > artifact creation populates the **index** but deliberately does **not** touch the
   > workflow record's `agent_outputs`.

2. **Index visibility.** From this point `list_artifacts_for_request` → §1 resolver returns
   the image. **The agent can "see" it.** No workflow-record write has happened yet.

3. **⭐ THE MOVE — index → `agent_outputs` (manual, agent-driven).** For the pre-publish
   validator to accept the image, its `ArtifactReference` (with a `blobKey` matching
   `MAJOR_KEY_ARTIFACT_REF_RE`, `save-json-blob.ts:1542`) must appear in
   `record.agent_outputs[*].output.artifactReferences`. The **only** mechanism that puts it
   there is the agent calling `<agentName>_update_output` (e.g. `final_article_update_output`)
   with a top-level `output.artifactReferences: ArtifactReference[]` array. The tool
   description spells out the contract and its failure mode — `mcp.ts:1196-1199`:

   > "IMAGE ARTIFACT CONTRACT: Image artifacts MUST be supplied as a top-level
   > `output.artifactReferences: ArtifactReference[]` array to be picked up by publish. …
   > Any other nesting … is silently dropped by the publish pipeline and will produce a
   > publish with an empty media array."

   **Nothing performs this move automatically.** It is not done at creation (step 1 is
   `skipped_by_design`), not by `list_artifacts_for_request`, and not by `patch_canonical_input`
   (which *validates against* `agent_outputs` but never *writes into* it). If the agent skips
   this call — or nests the refs anywhere other than `output.artifactReferences` — the blobKey
   stays index-only forever.

4. **Staging the pointer.** The agent points article nodes / publish payload at the image via
   `save_json_blob_patch_canonical_input` (`mcp.ts:891`, `:3127`) →
   `save-json-blob.ts` `patch_canonical_input`. Here `gatherTrustedArtifactRefs` (§1) is the
   gate. This **only succeeds if step 3 already happened.**

5. **Publish.** `save_json_blob_publish_by_time` computes
   `artifactReferences = await getArtifactReferencesForRequest(event, requestId)`
   (`mcp.ts:1934`, the **index**) and passes it to `buildCanonicalPublishPayload`
   (`mcp.ts:1937`, `:1991`). That builder additionally folds in
   `record.agent_outputs.final_article.output.artifactReferences` (`mcp.ts:1820-1829`) and
   resolves cross-request pointers from the index (`mcp.ts:1834-1851`). Publish is therefore
   the **permissive** path — index ∪ `final_article` outputs ∪ cross-request index lookups.

**The pinch point is step 3.** The blobKey has to move from the index into `agent_outputs`
*before staging in step 4*, and only an explicit `<agentName>_update_output` call does it.
Staging (strict, `agent_outputs`) and publishing (permissive, index) never agree on their input.

---

## 3. Why `list_artifacts_for_request` succeeds but `patch_canonical_input` fails for the same image

Directly from §1 + §2:

- `list_artifacts_for_request` → `getArtifactReferencesForRequest` → **artifact-index store**.
  Immediately after creation (step 1/2), the image is in `by-request/<requestId>/…`, so it is
  listed. ✅
- `patch_canonical_input` → `gatherTrustedArtifactRefs` → **`agent_outputs[*].output.artifactReferences`**.
  Until the agent runs step 3 (`<agentName>_update_output`), the blobKey is absent from
  `agent_outputs`, so `validateTrustedArtifactRef` (`save-json-blob.ts:1662-1686`) and
  `applyNodePatch` (`save-json-blob.ts:1690`, node_patches gate at `:1731-1738`) reject it with
  HTTP 400: *"is not found in agent_outputs artifact indexes for this record."* ❌

Same image, same `blobKey`, two different lookups. The agent's mental model ("I can list it,
therefore it's usable") is index-based; the staging gate is `agent_outputs`-based. That gap is
exactly the "inconsistent" publishing failure. It is intermittent because it depends entirely on
whether the agent happened to make the `<agentName>_update_output` call (and place the refs at
the exact `output.artifactReferences` path) for that particular run.

---

## 4. Blast radius: every caller that gates on `gatherTrustedArtifactRefs`

There are **two independent implementations** of the same concept, and both must be considered
when changing the trust source.

### A. `save-json-blob.ts` (`gatherTrustedArtifactRefs` at `:1559`) — called once at `:2020`

Inside the `patch_canonical_input` mutation retry loop, the produced `trustedRefs` Set gates:

1. **`replace_image_asset_register`** → `requireRegisterTrustedRefs` (`:2025`) →
   `validateTrustedArtifactRef` for each entry's `url` / `repoPath` (`:1877`).
2. **`promote_publish_payload`** → `validatePublishPayloadImageRefs` (`:2029`) →
   `validateTrustedArtifactRef` for `featuredImage`, `existingFeaturedImagePath`,
   `images[].{src,url,blobKey}`, `mediaEntries[].{src,url,blobKey}`, and
   `artifactReferences[].blobKey` (`:1895`, `:1908`, `:1926`).
3. **`node_patches`** → `applyNodePatch` (`:2057`) → gates `public_media_src` against
   `trustedRefs` (`:1731`).

### B. `admin-patch-workflow.ts` (a **duplicate** `gatherTrustedArtifactRefs` at `:65`) — called at `:191`

Same logic (identical `MAJOR_KEY_ARTIFACT_REF_RE` at `:60`, same `agent_outputs` scan). Its
`trustedRefs` gates:

4. **`promote_publish_payload`** (admin path) → `validatePayloadImageRefs` (`:192` → `:93`) →
   `validateImageRef` (`:82`) for the same field set as (2).

### What does **not** gate on it

- The actual publish resolution (`save_json_blob_publish_by_time` →
  `getArtifactReferencesForRequest` / `buildCanonicalPublishPayload`) does **not** consult
  `gatherTrustedArtifactRefs`. It trusts the index. So changing `gatherTrustedArtifactRefs`
  affects **staging/patching admission only**, not what publish ultimately emits.

**Implication:** any "unify the trust index" change touches **two files / two copies** of the
gather logic (`save-json-blob.ts` and `admin-patch-workflow.ts`). Loosening only one leaves the
other rejecting. Consolidating them into one shared helper is a prerequisite for a clean fix.

---

## 5. What "unify the trust index" should mean

### Single authoritative source: the artifact-index blob store

Recommendation: make the **artifact-index blob store** (`by-request/<requestId>/` +
`request-artifacts/<requestId>/`, i.e. the source already used by
`getArtifactReferencesForRequest`) the **one authority** for "does this image exist / is it
trusted for this request." Rationale:

- It is the store that is populated automatically at artifact creation
  (`writeArtifactReferenceIndexes`, §2 step 1), so it has no manual-copy dependency.
- It is already what `list_artifacts_for_request` and the publish resolver use, so unifying on
  it makes "what the agent can see" == "what it can stage" == "what publish emits."
- It carries soft-delete state (`isDeletedArtifactReference`) that publish already honors.

### Role of `agent_outputs` afterward: **cache / fast-path, not authority**

`agent_outputs[*].output.artifactReferences` should become an **optional, advisory cache** —
useful for provenance, display, and a fast in-memory check — but a miss there must **fall through**
to an index lookup rather than a hard HTTP 400. Concretely, the staging validator would become:

```
trusted(blobKey) := blobKey ∈ agent_outputs refs   // fast path
                 OR readArtifactReference(indexStore, requestId, sha) exists && not deleted
```

so that an index-resident, non-deleted, well-formed `MAJOR_KEY` ref for this request is accepted
even when the agent forgot the `<agentName>_update_output` copy.

### Recommended design (one option, with tradeoffs)

**Design R — index-authoritative staging with a shared helper.**
Introduce one shared `resolveTrustedArtifactRefs(event, record)` used by *both*
`save-json-blob.ts` and `admin-patch-workflow.ts`, that unions the `agent_outputs` set (cache)
with an index query for the request. Keep publish as-is (already index-based).

- **Pros:** eliminates the list-vs-patch discrepancy (§3) at its root; removes the fragile
  manual "move" as a *hard requirement*; de-duplicates the two gather implementations (§4);
  publish and staging finally share one notion of validity.
- **Cons / tradeoffs:**
  - Staging mutations become **async** and do an extra blob read (they are currently a pure
    in-memory scan of the loaded record). Cost is one `readArtifactReference` per candidate
    blobKey; bounded and cacheable per request.
  - The index accepts artifacts created under this `requestId` regardless of which agent made
    them — a slightly **wider trust surface** than "an agent explicitly published this ref."
    Mitigation: still require `MAJOR_KEY_ARTIFACT_REF_RE` shape, still reject data-URIs / remote
    URLs / legacy paths (`rejectUnsafeStringValue`), still honor soft-delete, and keep
    cross-request refs gated (the existing `annotateMediaScoping` / `scoped_to_request_id`
    portability checks, `save-json-blob.ts:1604-1640`).
  - Cross-request images (Major Key refs owned by another `requestId`) are **not** covered by a
    same-request index query; those still rely on `buildCanonicalPublishPayload`'s cross-request
    resolution at publish. Staging of cross-request pointers should remain explicitly opt-in.

**Alternative considered — keep `agent_outputs` authoritative, auto-populate it.** Make artifact
creation (or a reconcile step) auto-write refs into `agent_outputs` so the strict gate passes.
Rejected as the primary recommendation because it fights the documented
`workflowPatchStatus: "skipped_by_design"` boundary (`pdf-tool` deliberately does not mutate the
workflow record) and would require a new writer into workflow state with its own lock/version
concerns. It is viable as a *fallback* if index reads during staging prove too costly.

---

## 6. What could NOT be determined from the code (needs runtime / out-of-scope verification)

1. **`pdf-tool` internals.** The `pdf-tool` repo was not readable here (GitHub scope =
   `vreich-ui/dr-lurie-blog` only). I could not directly confirm `getAgentArtifactJobStatus`
   returning `workflowPatchStatus: "skipped_by_design"` at `netlify/lib/agent-artifact-mcp.ts:57`,
   nor **exactly how** a `pdf-tool`-generated reference reaches Dr. Lurie's `artifact-index` store
   (does `pdf-tool` write the index directly, or does it hand bytes to Dr. Lurie's
   `save-artifact`/`artifact-upload`?). §1 proves the index *is* the source `list` reads, so the
   write happens somewhere; the writer identity is unverified. The task's anchor and
   `docs/agents/pdf-tool-artifacts.md` are consistent with "creation populates index, not
   `agent_outputs`," which is what this diagnosis relies on.

2. **Whether real failing publishes are the strict-gate rejection (§3) or the silent-drop (§2
   step 3 / `mcp.ts:1198`).** Both produce "images missing at publish," but one is an HTTP 400 at
   `patch_canonical_input` and the other is a 200 publish with an empty `media` array. Confirming
   which dominates needs production logs (look for the `agent_outputs artifact indexes` 400 string
   vs. `cross_request_artifact_not_found` events at `mcp.ts:1844`).

3. **How often agents actually call `<agentName>_update_output` with correctly-placed
   `output.artifactReferences`.** The whole intermittency hinges on this; it is agent-behavior /
   trace data, not determinable from the server code.

4. **Pointer/reference consistency in the live index.** The resolver prefers `by-request/`
   pointers and only falls back to `request-artifacts/` when *no* pointers exist
   (`mcp.ts:2535-2541`). If pointer writes ever partially fail (one of the `Promise.all` writes in
   `writeArtifactReferenceIndexes` lands but another does not), a request could have stale/partial
   pointers that mask some references. Whether this occurs in production needs store inspection.

5. **Eventual-consistency timing of the blob store.** If `list`/publish read the index shortly
   after a write, an index read-after-write lag could make an image appear or disappear between
   `list_artifacts_for_request` and publish independently of the `agent_outputs` split. Needs
   runtime measurement against the actual Netlify Blobs backend.
