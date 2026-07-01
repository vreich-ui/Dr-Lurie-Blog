# Agent naming convention

Agents own semantic names. Backend code owns immutable storage keys, hashes, internal IDs, normalized public routes, and final storage path derivation.

## Canonical utility

The canonical implementation is `src/lib/agents-naming.ts`. Use it for all new validators, serializers, and payload builders that touch agent-authored names.

API:

- `normalizeMachineSafeId(value)` converts text to lowercase `snake_case` machine IDs.
- `validateRequestId(value)` enforces `req_<flow>_<topic>_<yyyymmdd>_<nn>`.
- `validateTemplateId(value)` enforces `tpl_<project>_<purpose>_<variant>_v<version>`.
- `validateSlot(value)` enforces `pdf_<purpose>`, `download_<purpose>`, `img_<role>`, `img_<role>_<nn>`, or generic `<kind>_<purpose>` slots.
- `normalizeSlug(value)` and `validateSlug(value)` normalize and enforce kebab-case article slugs.
- `normalizeFilename(value)` and `validateFilename(value)` normalize readable kebab-case filenames with optional extensions.
- `normalizeLabel(value)` and `normalizeCtaLabel(value)` preserve human-readable labels while compacting whitespace.

## Policy

- Machine-safe IDs use only lowercase letters, digits, and underscores.
- Filenames are readable kebab-case and are never storage keys.
- Labels and CTA labels are reader-facing human text.
- Slots identify artifact role, not storage location.
- Store and preserve exact returned `ArtifactReference` objects.
- Never synthesize blob keys, repository paths, or public download URLs from request IDs, filenames, or hashes when an exact immutable artifact reference is available.
- Public PDF/image URLs must come from returned artifact metadata or an explicit backend route contract, such as the existing `blobKey`-backed Netlify functions.
- Internal machine-authored JSON should prefer snake_case unless an authoritative downstream schema requires different field names.
- Avoid maintaining both `requestId` and `request_id` in the same internal payload except at integration boundaries that already require the mapping.

## Backend contract exceptions

Existing MCP tool schemas use `requestId` for artifact tools and `request_id` for workflow JSON tools. Keep those public schema names stable, validate the values with the canonical utility, and map only at the boundary.
