# CMS Architecture — Session 2: Architecture & Schema (end-state design)

Date: 2026-07-02. Branch: `docs/cms-architecture-design`. Prerequisite reading: `docs/cms-architecture/01-audit.md` (cited throughout as **A§x.y**). This document describes the *end state* only — no sequencing, phasing, or migration planning (later session). No implementation code exists for anything here.

Design ground rules inherited from the audit and honored throughout:

- **Netlify Blobs remain the source of truth; git-committed files are derived exports** (A§1.7). Every new concept follows this pattern.
- **Locking stays record-level** (one lease per object), matching the deliberate article-level lock decision (A§1.2). Finer granularity appears only as an explicit open question (OQ-1), never as a silent default.
- **The article review/diff mechanism is the default review pattern** for all agent-editable surfaces (A§1.3–1.4); deviations are argued explicitly (§5.7).

---

## 0. Resolved design forks (summary)

The audit surfaced six findings that force decisions. Each is resolved here and elaborated in the referenced section:

| # | Audit finding | Decision | Where |
|---|---|---|---|
| 1 | Node "types" are metadata combinations; three files must agree (A§1.1, A§1.9) | **Sections use a strict discriminated union** backed by a single Component Registry (one module per type owns schema + renderer + editor hints). Article nodes keep the combinatorial pattern — the two grammars are siblings under one envelope, not one generalized grammar. | §2.5, §3.5, §4.2 |
| 2 | Three divergent publish semantics (A§1.6) | **Canonical semantics = generalized `publish_by_time`** as one operation: materialize + commit the export first, then stamp timestamp + receipt (§5.6 ordering). The admin UI button becomes a client of it; `toggle-article-publish` is deprecated as a source-of-truth violation. | §5.6 |
| 3 | Taxonomy uncontrolled + drifts between blob drafts and frontmatter (A§2.11) | **One Taxonomy registry object in Blobs** is the sole vocabulary; publish-time validation resolves terms against it; the drift-y `admin-taxonomy` aggregation endpoint is replaced. **No Topic entity** — topics remain a presentation of categories (A§2.7). | §5.5 |
| 4 | No permissions model exists — binary admin/not-admin (A§2.12) | Human Review + roles are **explicitly greenfield design**, not formalization of an existing pattern. Minimal role set, enforced server-side. | §5.7 |
| 5 | Dual auth: Netlify Identity for humans, shared `x-publish-key` for agents (A§1.8, A§2.12) | The agent-operability contract is built **on the existing paired-endpoint pattern** (identity-auth admin endpoints + publish-key/MCP endpoints writing to the same records). No unified identity layer is assumed. Per-agent credentials are an open question (OQ-3). | §5.8 |
| 6 | Two footers, two page-building idioms (A§2.1, A§2.3, A§2.10) | **One mechanism ends both forks**: every page is Sections rendered by registry components; the footer is a single Navigation-fed Section type, and page-level variation is expressed only as *data* (a different Navigation instance referenced by the Page record), never as a code-level slot override. AstroWind-widget and `dl-*` idioms both dissolve into Component Registry implementations. | §2.5, §4.3, §5.4 |

---

## 1. The core pattern: one object model, generalized from the article record

The audit's single most reusable asset is the `WorkflowRecord` envelope and its operational machinery: blob-stored JSON keyed by stable ID, record-level lock lease, append-only history, record-level optimistic `version`, timestamp-gated publication, and derived git export (A§1.1, A§1.2, A§1.6, A§1.7). Everything the article stack does well — agent writes under lock via MCP, human edits via identity-auth endpoints, Accept/Discard review, publish receipts — hangs off that envelope, and none of it is intrinsically article-specific.

**Decision:** the CMS layer is a set of typed objects that all share one envelope (`ObjectRecord`, §3.1), which is the existing `WorkflowRecord` with the article-specific fields (`current_stage`, `next_agent`, `agent_outputs`, `completed_agents`, `failed_agents`, `needs_review` — the five-agent pipeline machinery, A§1.1) factored into an optional per-type extension. Articles become one object type among several rather than the only structured thing in the system.

Object types: `site`, `page`, `page_type` *(registry, code — see OQ-4)*, `template`, `section` *(shared/global sections only; page-local sections embed in the Page record)*, `navigation`, `taxonomy`, `content_item` *(articles today)*.

**Storage.** New blob store `site-objects` (strong consistency, matching `workflows`/`artifacts`/`artifact-index`, A§1.1), keys `objects/{object_type}/by-id/{object_id}.json`, with marker-blob indexes `objects/{object_type}/index/by-status/{status}/{object_id}` mirroring the existing `workflows/index/...` convention (A§1.1). Articles physically stay in the `workflows` store under their existing keys. **This is NOT mechanical compatibility**: a stored `WorkflowRecord` (A§1.1) has `request_id` and `input` plus top-level pipeline fields, and lacks `object_id`, `object_type`, `site`, `body`, the envelope `publication` block, and `content_revision`. The envelope is compatible *by mapping*, not by shape — generic object verbs (§5.8) touching articles require an explicit **adapter** that translates on read/write: `request_id → object_id`, constant `object_type: 'content_item'`, default `site`, `input → body`, `input.publication.published_time ↔ publication.published_time` (kept in sync per §5.6), top-level pipeline fields → the `workflow` extension, and `content_revision` seeded on first adapted write (approvals can only pin revisions minted after adoption). Adapter-vs-one-time-migration is OQ-8; what is not optional is that one of them exists — aliasing without the adapter would make generic verbs reject every existing article.

**Derived exports.** Publishing an object materializes a committed file consumed by the Astro build, exactly as articles materialize `src/data/post/{slug}.md` (A§1.6–1.7):

```
src/data/site/site.json                     ← Site
src/data/site/navigation/{nav_id}.json      ← Navigation instances
src/data/site/taxonomy.json                 ← Taxonomy registry
src/data/site/templates/{tpl_id}.json       ← Templates
src/data/site/sections/{sec_id}.json        ← shared Sections
src/data/site/pages/{page_id}.json          ← Pages (one file per page)
src/data/post/{slug}.md                     ← Content Items (unchanged)
```

Every derived JSON file carries a top-level `"__generated": {from, at, record_version}` marker — directly resolving the audit flag that derived `.md` files carry no generated-file marker (A§1.7). The public site continues to build statically from git and never reads Blobs at runtime, preserving the current deployment model (A§1.7).

---

## 2. Architecture overview: the twelve concepts

Relationship diagram (ownership/reference, not dataflow):

```
Site ─┬─ owns → Navigation instances (header, footer, …)
      ├─ owns → Taxonomy registry
      ├─ owns → Pages ──┬─ declares → PageType (registry)
      │                 ├─ optionally instantiates → Template
      │                 ├─ contains → Section instances (inline)
      │                 └─ references → shared Sections, Navigation variants
      ├─ owns → Templates ── constrain/prefill → Sections
      └─ owns → Content Items (articles) ── carry → article_body.v1 nodes
Component Registry (code) ── defines schema+renderer+editor per Section type
Renderer = registry lookup + pure Astro component (§4)
Publishing Workflow + Human Review = envelope-level machinery on every object (§5.6–5.7)
```

### 2.1 Site

The root configuration object. Replaces the current three-way split of site identity across `src/config.yaml`, hardcoded CSS custom properties in `CustomStyles.astro:29-74`, and the hardcoded logo string in `Logo.astro:6` (A§2.13). Holds: name, logo text/asset, URL, metadata defaults, brand tokens (colors/fonts as data), feature flags currently passed as ad-hoc Header props (`showRssFeed`, `showToggleTheme`, A§2.2), and default OG images. Its derived export feeds the `astrowind:config` virtual-module mechanism (A§2.10) — the injection plumbing survives; its source becomes a published object instead of a hand-edited YAML file.

### 2.2 Page

A routable URL surface: route, PageType, SEO block, ordered list of Section instances, optional Template reference, optional navigation variant references. Replaces the hardcoded `.astro` page files documented in A§2.1/A§2.9 (homepage, about, start-here, solutions/*, newsletter, etc.). A Page is the unit of locking, review, and publishing for everything it inlines — deliberately matching the article-level lock decision (A§1.2): editing any section of a page takes the page's single lease.

### 2.3 PageType

The semantic class of a page: `home`, `standard`, `listing`, `content_detail`, `system` (404, thank-you). A PageType defines: the route pattern and loader behavior (e.g., `listing` pages paginate a content query the way `getStaticPathsBlogList` does today, A§2.5), which Section types are allowed/required, and which review policy applies (§5.7). PageTypes formalize the informal "repeated layout patterns" the audit found (A§2.10) — the two coexisting idioms (AstroWind widget pages vs. bespoke `dl-*` pages) collapse into PageType + Sections. PageTypes live in code as a registry (like the Component Registry) because they bind to route files and loaders; exposing them read-only over MCP keeps them agent-*inspectable* without making route generation data-driven. Making PageType itself a blob object is OQ-4.

### 2.4 Template

A reusable, named arrangement: an ordered list of Section *blueprints* (type + default data + slot rules: required/optional/repeatable) that a Page instantiates and may then diverge from. Templates are data (blob objects), not code — they capture "what the audit calls a repeated layout" as an editable object. A Template does not render; it constrains and prefills. This is the formal replacement for "informal template system" (A§2.10).

### 2.5 Section — and the central typing decision (audit fork #1)

A Section is one typed block on a page: `{ id, type, data, visibility, notes? }`.

**Decision: Sections are a strict discriminated union on `type`, validated per-type by the Component Registry — they do *not* adopt the article node's combinatorial pattern.** And symmetrically: **article nodes are not migrated to the union.** Section and article-node are sibling specializations of the shared envelope/editing machinery, not one grammar.

Reasoning against the audit record:

- The article pattern (generic node; semantics smeared across `kind` × `rendering.presentation` × `private.strategy` × `commercial.type`) exists to serve *editorial prose*, where strategy, commercial intent, and presentation are genuinely orthogonal axes on the same paragraph (A§1.1). Pages have no equivalent payoff: a hero is a hero; its "strategy" doesn't vary independently of its shape. Reproducing the combinatorial pattern for sections would recreate, at page scale, exactly the cost the audit flagged: `input-bank.ts`, `node-renderer.ts`, and `to-markdown.ts` are three places that must independently agree, and any new consumer becomes a fourth (A§1.9). A discriminated union with a per-type registry module makes agreement structural: **one module per type owns the zod schema, the renderer, and the editor affordances** (§3.5) — there is nothing left to keep in sync by convention.
- Migrating article nodes to the union is rejected because the combinatorial contract is load-bearing for the deployed agent ecosystem: MCP tools validate `article_body.v1` (A§1.8), node IDs are *required* to be opaque and are forbidden from containing type-ish words (`article-content-v1.ts:166-179`, A§1.1), and the strategy/commercial metadata is exactly what `assert-reader-safe.ts` exists to keep private (A§1.1). A union with type names like `offer_card` would violate the opaque-ID/no-strategy-words principle the article schema deliberately enforces.
- **Stated tradeoff of this decision:** two block grammars coexist permanently (union sections; combinatorial article nodes). The costs: (a) the block editor carries two editing models — mitigated because it already does (per-presentation TipTap extension sets, A§1.5); (b) agents must learn two shapes — mitigated by both living under the same envelope, lock discipline, and MCP verb set (§5.8); (c) a future "article embedded in a page" boundary needs an explicit bridge Section type (`content_embed`, §3.5) rather than falling out for free. The alternative costs were judged higher: a union migration breaks the working agent contract; a combinatorial page grammar re-imports the three-way-agreement problem the audit explicitly flagged.

So: **Section is a parallel structure, deliberately — not a generalization of the article node.** What *is* generalized is everything around the blocks: envelope, IDs, locking, history, review, publishing.

Sections come in two flavors: **inline** (embedded in the Page record — the default; most sections belong to one page) and **shared** (their own `section` object, referenced from any page through a dedicated `shared_ref` union member — global footer content blocks, the newsletter signup, reusable CTA banners). A reference is its own variant carrying only the target's ObjectId — never a shadow copy of the target's type or data — and the Renderer dereferences it to the target's current variant before validation and dispatch (§3.5), so no consumer ever special-cases references or reads stale duplicated payloads. Shared sections have their own lock/review/publish lifecycle; this is how one newsletter block appears on N pages without N copies (the audit found exactly one real newsletter form hardcoded into the homepage, A§2.4).

### 2.6 Component

A code-level implementation unit registered in the **Component Registry**: `{type, schema, astroComponent, editorHints, preview}` (§3.5). Components are the *only* things that render Section data. Both existing idioms feed the registry's implementations: prop-driven AstroWind widgets (already close to pure — `Footer.astro` is fully prop-driven today, A§2.3) get wrapped as-is; hand-rolled `dl-*` sections get extracted from page files into components. Neither idiom survives as a page-authoring mechanism (audit fork #6): pages author *data*, only the registry authors markup.

### 2.7 Renderer

The thin engine that turns a published Page into HTML at build time: route file → load derived Page JSON → resolve references (navigation trees, taxonomy labels, content queries, media paths) → for each visible section, registry lookup by `type` → render the Astro component with validated `data` + `resolved` props (§4). The Renderer owns iteration, visibility filtering, and reference resolution; components own markup only. For articles, the public renderer is unchanged (markdown via content collection, A§1.7); the *admin draft preview* becomes a server-rendered route using the same registry components, eliminating the duplicated hand-mirrored renderer the audit flagged (`node-renderer.ts` "mirrors the public blog's block styling", A§1.9) — see §4.4 and OQ-9.

### 2.8 Content Item

Structured editorial content with its own lifecycle — today, exactly the article: `ContentSourceV1` + `article_body.v1`, kept schema-identical (A§1.1). In the object model, a Content Item is `object_type: 'content_item'` whose envelope carries the `workflow` extension (the five-agent pipeline fields). Pages *reference* content items through query-driven sections (`content_grid` with a real query replaces the homepage's placeholder "Start here" titles, A§2.1/A§2.13) — content never gets copy-pasted into pages. Future content kinds (guides, bios) would be new `content_item` kinds; not designed here.

### 2.9 Taxonomy

A controlled vocabulary object: category and tag term registries with stable term IDs, slugs, labels, and lifecycle status (§3.7). Single source of truth resolving audit fork #3 (A§2.11); details in §5.5.

### 2.10 Navigation

Menu structures as data: header groups/actions, footer groups, secondary links, social links — the shapes already present in `navigation.ts` `headerData`/`footerData` (A§2.2–2.3), promoted from TypeScript source to publishable objects with typed link targets (page references, taxonomy references, external URLs, assets) instead of raw hrefs. Details and the footer consolidation in §5.4.

### 2.11 Publishing Workflow

The envelope-level publish machinery, with one canonical semantics (audit fork #2 resolved in §5.6): `publish(object, published_time)` = validate → materialize derived export → git commit → **then** stamp + receipt in one write (export-first; the record can never claim a publish with no committed export), generalized from `publish_by_time` → `publish-article.ts` (A§1.6 mechanism 2).

### 2.12 Human Review

Greenfield (audit fork #4): review state on the envelope, a minimal role model over the existing dual-auth reality, and the article diff-overlay pattern as the default review UI for all object types (§5.7).

---

## 3. Data model / schema sketches

Sketches, not implementations. Zod-per-type is implied wherever an interface is shown (matching the existing schema style, A§1.1). For each schema, the **Δ note** states how it extends or deviates from the existing Blobs JSON pattern.

### 3.1 The shared envelope: `ObjectRecord`

```ts
type ObjectType =
  | 'site' | 'page' | 'template' | 'section'
  | 'navigation' | 'taxonomy' | 'content_item';

// Opaque, prefix-typed, no site name embedded (multi-site scoping note).
// Prefixes: site_, page_, tpl_, sec_, nav_, tax_, req_ (content items keep req_* ids).
//
// The generic shape below is a CEILING, not the validator. Every object type applies
// its own stricter ID validator on creation, and generic creation paths (object_create
// verbs, §5.8) MUST route through the per-type validator. In particular, content_item
// keeps validateRequestId verbatim — req_<flow>_<topic>_<yyyymmdd>_<nn>
// (agents-naming.ts, A§1.8) — because the artifact-upload path validates requestId with
// that helper; a looser req_* accepted at creation would produce records that cannot
// upload artifacts or interoperate with existing workflow tools. This is exactly the
// autogen-mismatch bug class the audit documented (createRequestId() producing ids
// the backend rejects, A§1.9); the design must not reintroduce it from the other side.
type ObjectId = string; // ceiling: /^(site|page|tpl|sec|nav|tax|req)_[a-z0-9_]+$/

interface ObjectRecord<TBody> {
  object_id: ObjectId;
  object_type: ObjectType;
  schema_version: string;              // e.g. 'page.v1' — per-type versioning, same style as
                                       // content_source.v1 sub-versioning (A§1.1)
  site: string;                        // site object_id; single value today (scoping note)
  created_at: string;                  // ISO
  updated_at: string;                  // ISO
  status: 'active' | 'archived';
  body: TBody;                         // per-type payload, zod-validated

  publication: {
    published_time: string | null;     // identical semantics to articles: null/missing = not
                                       // live, future = scheduled, past = live (A§1.7)
    publish_receipt?: PublishReceipt;  // mirrors the receipt written back by publish_by_time
                                       // (A§1.6 step: mcp.ts:2027-2035)
  };

  review?: ReviewState;                // §3.9 — greenfield (A§2.12)
  lock?: WorkflowLockRecord;           // IDENTICAL shape to schema-v1.ts:34-40 (A§1.2)
  history: HistoryEntry[];             // same append-only pattern as WorkflowRecord.history
  version: number;                     // record-level optimistic concurrency (A§1.1);
                                       // bumped by EVERY write incl. lock ops (A§1.2)
  content_revision: number;            // NEW: bumped ONLY by writes that mutate `body`.
                                       // Lock checkout/checkin/refresh, review bookkeeping,
                                       // and the publish operation's own publication write
                                       // (the §5.6 step-5 stamp+receipt) do NOT touch it.
                                       // Exists so review
                                       // approvals can pin content state (§3.9) without
                                       // being invalidated by the lock acquisition that
                                       // publishing requires (§5.6 step 1) — or by the
                                       // publish stamp itself: publishing CONSUMES an
                                       // approval; it must never invalidate it.

  // Article-only extension: the five-agent pipeline fields lifted verbatim from
  // WorkflowRecord (A§1.1). Absent on all other object types.
  workflow?: {
    workflow_status: 'pending' | 'in_progress' | 'completed' | 'failed';
    current_stage: AgentName | null;
    next_agent: AgentName | null;
    completed_agents: AgentName[];
    failed_agents: AgentName[];
    last_error: string | null;
    needs_review: boolean;
    agent_outputs: Partial<Record<AgentName, AgentOutputEnvelope>>;
  };
}

interface HistoryEntry {
  at: string;
  action: string;                      // e.g. 'admin_update_section', 'admin_checkout',
                                       // 'agent_patch', 'publish', 'review_decision'
  actor: Principal;                    // §3.9 — extends today's owner_id/owner_label strings
  details?: Record<string, unknown>;
}
```

**Δ note:** This is `WorkflowRecord` (A§1.1) with (a) article pipeline fields moved into an optional `workflow` block, (b) `input: ContentSourceV1` generalized to `body: TBody`, (c) a first-class `publication` block (articles already have this inside `input.publication`, A§1.1 — it is promoted to the envelope so every type gets timestamp-gated publishing), (d) a structured `actor` on history entries where today's history stores loose `owner_id/owner_label` details (A§1.2), (e) a greenfield `review` block, and (f) a new `content_revision` counter alongside `version`. (f) exists because the audit documents that lock operations increment `version` (checkout/checkin/refresh all bump it, A§1.2) — so `version` cannot serve as the "has the content changed since approval?" signal; publishing requires taking the lock (§5.6 step 1), and an approval pinned to `version` would be invalidated by the lock acquisition itself. `version` keeps its existing every-write semantics untouched. Lock shape, version discipline, and history semantics are unchanged — deliberately, so `lock-manager.ts` / `admin-workflow-lock.ts` generalize by parameterizing the blob key (today hardcoded to `workflows/by-id/{requestId}.json`, A§1.2).

### 3.2 Site

```ts
interface SiteBody {                                  // 'site.v1'
  name: string;                                       // replaces config.yaml site.name (A§2.10)
  logo: { text: string; imageAssetRef?: string };     // replaces Logo.astro hardcode (A§2.13)
  urls: { base: string; canonicalHost: string };
  metadataDefaults: {                                 // replaces config.yaml metadata block
    titleTemplate: string; description: string;
    ogImage: string; twitterHandle?: string;
  };
  brandTokens: {                                      // replaces CustomStyles.astro literals
    colors: Record<string, string>;                   // (A§2.13)
    fonts: { sans: string; serif: string; heading: string };
  };
  chrome: {                                           // replaces ad-hoc Header props (A§2.2)
    showRssFeed: boolean; showThemeToggle: boolean;
    announcement?: { enabled: boolean; sectionRef?: ObjectId };
  };
  defaultNavigation: {                                // the ONLY place default menus bind
    header: ObjectId; footer: ObjectId;               // (consolidation, §5.4)
    secondary?: ObjectId; social?: ObjectId;
  };
  blog: {                                             // replaces config.yaml apps.blog (A§2.10)
    listPath: string; postsPerPage: number;
    categoryBase: string; tagBase: string;
  };
}
```

**Δ note:** net-new object type; the *pattern* (blob object → derived export → build-time injection) is the article pattern applied to configuration. Multi-site-safe by construction — it *is* the per-site root.

### 3.3 Page

```ts
interface PageBody {                                  // 'page.v1'
  route: string;                                      // '/', '/about', '/start-here', …
  pageType: PageTypeId;                               // §3.4
  title: string;
  seo: { title?: string; description?: string; ogImage?: string;
         robots?: { index: boolean; follow: boolean } };
  template?: { ref: ObjectId; instantiated_at: string }; // provenance, not live inheritance
  sections: SectionInstance[];                        // ordered; §3.5
  navigationOverrides?: {                             // DATA-ONLY variation (§5.4):
    footer?: ObjectId;                                // reference another Navigation instance.
    header?: ObjectId;                                // No slot/code overrides exist.
  };
}
```

**Δ note:** net-new type on the shared envelope. The page owns its inline sections the way an article owns its nodes (one record, one lock, one publish) — the direct structural analogue of `article_body.v1.nodes` (A§1.1), with the typing decision of §2.5 applied. `navigationOverrides` is the sanctioned replacement for the homepage's `<Fragment slot="footer">` code override (A§2.1).

### 3.4 PageType (code registry)

```ts
interface PageTypeDefinition {
  id: PageTypeId;                                     // 'home' | 'standard' | 'listing' |
                                                      // 'content_detail' | 'system'
  routePattern: string;                               // binds to an Astro route file
  allowedSections: SectionType[] | 'any';
  requiredSections?: SectionType[];
  listing?: {                                         // for 'listing': formalizes the
    source: 'content_items';                          // getStaticPathsBlogList/Category/Tag
    defaultQuery: ContentQuery;                       // pattern (A§2.5–2.6)
    paginate: boolean;
  };
  reviewPolicy: ReviewPolicy;                         // §3.9
}
```

**Δ note:** lives in code (exposed read-only via MCP), not Blobs — deviation from the everything-is-a-blob pattern, because PageTypes bind to route files and loaders that are necessarily code. See OQ-4. Multi-site: registry is shared across sites; per-site PageType variation would need real work later.

### 3.5 Section instances + the Component Registry

```ts
// ——— The discriminated union (audit fork #1 decision, §2.5) ———
type SectionInstance = SectionCommon & SectionVariant;

interface SectionCommon {
  id: string;                                         // /^s_[a-z0-9]+$/ — opaque like n_* node
                                                      // ids (A§1.1), stable across edits
  visibility?: 'public' | 'hidden';                   // subset of node visibility (A§1.1);
                                                      // 'internal' dropped — pages have no
                                                      // agent-notes-in-band use case
  notes?: string;                                     // editor/agent notes; never rendered
                                                      // (assert-reader-safe applies, A§1.1)
}

type SectionVariant =
  | { type: 'hero';            data: { kicker?: string; heading: string;
                                       body?: RichText; actions: LinkAction[] } }
  | { type: 'prose';           data: { body: RichText } }
  | { type: 'checklist';       data: { heading?: string; items: string[] } }        // "This is
                                                       // for you if…" (A§2.1)
  | { type: 'bio';             data: { heading: string; portraitAssetRef?: string;
                                       body: RichText; trustNotes: string[] } }     // (A§2.1)
  | { type: 'content_grid';    data: { heading?: string;
                                       source: { kind: 'query'; query: ContentQuery }
                                             | { kind: 'manual'; items: ObjectId[] };
                                       limit: number } }  // replaces placeholder grid (A§2.1)
  | { type: 'newsletter_signup'; data: { heading: string; body?: RichText;
                                         formName: string; consentText?: string } } // (A§2.4)
  | { type: 'contact_form';    data: { formName: string; heading: string;
                                       disclaimer?: string } }                      // (A§2.4)
  | { type: 'cta_banner';      data: { heading?: string; body?: RichText;
                                       actions: LinkAction[] } }
  | { type: 'faq';             data: { heading?: string;
                                       items: { q: string; a: RichText }[] } }
  | { type: 'link_list';       data: { heading?: string; links: LinkAction[] } }
  | { type: 'product_preview'; data: { heading: string; products: ProductCard[] } } // shop-
                                                       // preview page (A§2.9)
  | { type: 'search';          data: { placeholder?: string; indexRoute: string } } // extracts
                                                       // the hardcoded Header overlay (A§2.8)
  | { type: 'content_embed';   data: { contentItem: ObjectId } }  // explicit bridge to the
                                                       // article grammar (§2.5 tradeoff)
  | { type: 'shared_ref';      data: { section: ObjectId } };
                                                       // Reference to a shared 'section'
                                                       // object — its OWN variant, carrying
                                                       // no shadow copy of the target's
                                                       // type/data. The Renderer (and admin
                                                       // preview) dereference shared_ref to
                                                       // the target's current variant BEFORE
                                                       // validation and render dispatch, so
                                                       // no validator, editor, or component
                                                       // ever special-cases references or
                                                       // sees stale duplicated payloads.

interface LinkAction { label: string; target: NavTarget; style?: 'primary'|'secondary'|'link'; }
type RichText = string;   // TipTap-produced HTML constrained to the existing sanitizer
                          // allowlist: p,br,strong,em,a,ul,ol,li,h2,h3 (A§1.5)

// ——— The Component Registry: ONE module per type (resolves the 3-way agreement
//     cost of input-bank/node-renderer/to-markdown flagged in A§1.9) ———
interface ComponentDefinition<T> {
  type: SectionType;
  schema: ZodType<T>;                   // the single field-level source of truth
  component: AstroComponentFactory;     // pure renderer (§4)
  editor: {                             // replaces input-bank.ts's template role (A§1.1)
    label: string; icon: string;
    fieldHints: Record<keyof T & string, FieldHint>;
    defaultData: T;                     // blueprint for "insert new section"
  };
  resolveRefs?: (data: T, ctx: ResolveCtx) => Promise<ResolvedRefs>;  // §4.2
}
```

The union above is **seeded from what the audit actually found on real pages** (hero, qualifier checklist, article grid, bio, newsletter — A§2.1; contact form — A§2.4; product preview — A§2.9; search overlay — A§2.8/A§2.2). It is expected to grow; growth = adding one registry module + one union member (a code change — the accepted tradeoff of the union decision, §2.5).

**Δ note vs. article nodes:** same opaque-ID discipline, same visibility concept, same never-render-private-notes rule; deviates by replacing `kind`/`rendering`/`private.strategy`/`commercial` with the discriminated `type` (§2.5 rationale). Commercial metadata is deliberately *absent* from sections v1 — the audit found no commercial placements outside articles (`CallToAction` widget used only on template leftovers, A§2.4); if page-level commercial slots are wanted later, they enter as new union members with their own disclosure fields, not as a resurrected orthogonal `commercial` axis. Flagged as a scope choice, not an oversight.

### 3.6 Template

```ts
interface TemplateBody {                              // 'template.v1'
  name: string;
  appliesTo: PageTypeId[];
  slots: Array<{
    slotId: string;
    allowed: SectionType[];
    required: boolean;
    repeatable: boolean;
    blueprint?: SectionInstance;                      // default section (from registry
  }>;                                                 // editor.defaultData, customized)
}
```

**Δ note:** net-new; data-not-code, following blobs-are-truth. Instantiation copies blueprints into the Page (provenance kept in `page.template`); Pages do **not** live-inherit from Templates — matching how articles never live-inherit from `input-bank` templates (a template stamps `private.inputTemplateId` and the node is thereafter independent, A§1.1).

### 3.7 Taxonomy

```ts
interface TaxonomyBody {                              // 'taxonomy.v1'
  kinds: {
    category: { terms: Term[] };
    tag:      { terms: Term[] };
  };
}
interface Term {
  term_id: string;                                    // /^t_[a-z0-9]+$/ — opaque, stable;
                                                      // slugs/labels can be renamed safely
  slug: string;                                       // unique per kind; used in routes/
                                                      // frontmatter (A§2.6)
  label: string;
  description?: string;
  status: 'active' | 'deprecated';
  merged_into?: string;                               // term_id — rename/merge without breaking
                                                      // published frontmatter
}
```

**Δ note:** replaces two disconnected de-facto sources — free-string frontmatter (A§2.6, A§2.11) and the blob-draft aggregation endpoint (A§2.11) — with one registry object. Enforcement point: the canonical publish operation (§5.6) validates that a content item's `category`/`tags` resolve to `active` terms, extending the validation publish-article already performs on paths/artifacts (A§1.6 steps 2, 5–6). One taxonomy object per site (`site` field on the envelope) → multi-site-safe by construction; no fixed global vocabulary is baked in (scoping note).

### 3.8 Navigation

```ts
interface NavigationBody {                            // 'navigation.v1'
  role: 'header' | 'footer' | 'secondary' | 'social';
  brand?: { text?: string; descriptor?: string };     // Footer.astro brand/descriptor props
                                                      // (A§2.3)
  groups: Array<{
    id: string; title?: string;
    items: NavItem[];
  }>;
  actions?: LinkAction[];                             // header CTA(s) (A§2.2)
  footNote?: RichText;                                // Footer footNote (A§2.3)
}
interface NavItem {
  id: string;                                         // opaque, stable
  label: string;
  target: NavTarget;
  children?: NavItem[];                               // dropdown groups (A§2.2)
}
type NavTarget =
  | { kind: 'page';     page: ObjectId }              // resolved to route at materialize time
  | { kind: 'taxonomy'; termKind: 'category' | 'tag'; term_id: string }
  | { kind: 'listing';  list: 'content_index' }       // the blog Library route (A§2.5)
  | { kind: 'external'; href: string }
  | { kind: 'asset';    href: string };               // e.g. /rss.xml (A§2.3)
```

**Δ note:** promotes `navigation.ts` config objects (A§2.2–2.3) into publishable records; the shapes deliberately mirror `headerData`/`footerData` so migration is mechanical. Key deviation from today: link targets are typed references, not raw hrefs — a page rename re-materializes navigation instead of leaving dead links. Multi-site-safe by construction (instances are per-site records). **Amendments from the current-site mapping** (03 §1.2–1.3, recorded there with provenance): M-1 `NavItem.description?: string` (every header dropdown item carries one); M-2 `groups[].slot?: 'primary'|'secondary'|'social'` (footer secondary/social rows); M-5 `groups[].target?: NavTarget` (the top-level 'Start Here'/'Learn'/'Solutions' entries are themselves links, `navigation.ts:8,28,49`).

### 3.9 Human Review, roles, principals (greenfield — audit fork #4)

**Nothing below exists today in any form.** The audit is explicit: auth is a binary email allowlist; "No roles/permissions exist" (A§2.12). This is new design constrained to fit the dual-auth reality (A§1.8), not a formalization of an existing pattern.

```ts
type Principal =
  | { kind: 'human'; id: string; email: string }          // Netlify Identity (A§2.12)
  | { kind: 'agent'; agent_name: string;                  // self-declared name over the shared
      auth: 'publish_key' | 'mcp_token' };                // key — attribution is trust-based
                                                          // today (A§1.2 owner_label); OQ-3

type Role = 'admin' | 'publisher' | 'editor';             // humans; agents are a capability
                                                          // class, not a role (see below)

interface ReviewPolicy {
  required: boolean;                    // per object type / PageType
  minApprovals: number;                 // 1 in practice
  publishRoles: Role[];                 // who may execute publish (§5.6)
}

interface ReviewState {
  state: 'open' | 'changes_requested' | 'approved';
  decisions: Array<{
    at: string; by: Principal;
    decision: 'approve' | 'request_changes';
    note?: string;
    content_revision: number;           // approval pins the CONTENT revision it approved
                                        // (§3.1); a later `body` write reopens review.
                                        // Deliberately NOT the record `version`: lock
                                        // checkout/refresh/checkin bump `version` (A§1.2),
                                        // and publish itself must take the lock (§5.6
                                        // step 1). Publication stamps/receipts written by
                                        // the publish operation are likewise exempt (§3.1)
                                        // — pinning anything they move would let the act
                                        // of publishing invalidate its own approval.
  }>;
}
```

Default policy proposal (data, adjustable): `content_item` — review optional (matches today's flow where a human editor is the review, A§1.3); `page`, `template`, `section` — review required before first publish; `site`, `navigation`, `taxonomy` — review required on every publish (site-wide blast radius). Same *mechanism* everywhere; only policy differs — honoring the constraint that the article review pattern is the default (§5.7).

**Role storage:** minimal extension of the existing pattern — `ADMIN_EMAILS` (A§2.12) generalizes to a role map (e.g. `ROLE_EMAILS_ADMIN`, `ROLE_EMAILS_PUBLISHER`, `ROLE_EMAILS_EDITOR` env vars, or a `site` body field). Env-vs-blob is OQ-5. Agents: capabilities are bounded by which endpoints/tools the key reaches (A§1.8), plus a per-object-type allowlist in policy (e.g., agents may never execute `publish` on `site`/`navigation`/`taxonomy` without an approved review). Multi-site: role map is per-deploy today → "needs real work later."

### 3.10 Content Item (article) — unchanged schema, repositioned

`content_item.body = ContentSourceV1` exactly as documented (A§1.1), including `article_body.v1`. No field changes. The envelope's `publication` block supersedes reading `input.publication.published_time` as the gate (the inner field remains for agent-contract compatibility; the publish operation keeps both in sync — see §5.6). **Explicitly restated:** the union decision for Sections does **not** touch article nodes (§2.5). Taxonomy consequence of keeping the schema unchanged: category/tags stay free strings here, so rename/merge safety is provided *at the publish boundary*, not in the record — publish-time slug resolution follows `merged_into` aliases, canonical slugs are re-materialized into frontmatter, and resolved `term_id`s land in the publish receipt (§5.5). Content-item IDs likewise keep their stricter existing validator (`validateRequestId`, §3.1), not the generic ObjectId ceiling.

---

## 4. Component / renderer separation

### 4.1 What the audit says components own today (that they must lose)

- Copy and structure inline in page files: homepage's five sections and all their text live as literals and const arrays in `index.astro` (A§2.1); about/start-here/solutions likewise (A§2.9).
- Data fetching and behavior inside chrome: `Header.astro` hardcodes the entire search overlay UI *and* its client-side engine, fetching `/search.json` (A§2.2).
- Configuration reads scattered through the tree via `astrowind:config` (A§2.10) and brand tokens hardcoded in `CustomStyles.astro` (A§2.13).
- Structure forks in code: the homepage footer `<Fragment slot="footer">` override (A§2.1).
- A parallel hand-maintained admin renderer for article blocks (A§1.5, A§1.9).

### 4.2 The boundary: what a component receives, and what it no longer owns

Every registry component gets exactly three props and nothing else:

```ts
interface SectionRenderProps<T> {
  data: T;                 // the section's validated union payload — the ONLY content input
  resolved: ResolvedRefs;  // dereferenced pointers, computed by the Renderer at build time:
                           //   page targets → hrefs; taxonomy term_ids → {slug,label};
                           //   content queries → normalized post summaries (the shape
                           //   getNormalizedPost already produces, A§2.5);
                           //   asset refs → committed display paths (~/assets/…, A§1.6)
  ctx: RenderCtx;          // read-only site context: brand tokens, locale, urls
                           //   (from the Site derived export — replaces per-component
                           //   astrowind:config imports, A§2.10)
}
```

A component **may**: lay out markup, apply classes, choose responsive behavior, emit its own scoped client script for interactivity *whose inputs all arrive via `data`/`resolved`* (e.g. the search component receives `indexRoute` instead of hardcoding `/search.json`, A§2.2).

A component **no longer owns**: copy or link targets (data), section ordering and visibility (Renderer, from the Page record), data fetching (Renderer `resolveRefs` at build), queries (declared in `content_grid.data.query`, executed by the Renderer), configuration reads (only `ctx`), form endpoint wiring beyond the `formName` it is handed (the global opt-in mirroring stays in layout chrome, A§2.4), and — critically — *whether it appears at all*. No component may import `navigation.ts`, `astrowind:config`, or reach into another object; those imports are the structural smell the audit documented (A§2.2, A§2.10).

Reference resolution is centralized in the Renderer (per-type `resolveRefs` hooks in the registry, §3.5) so components stay synchronous and pure; this is the same discipline the publish pipeline already applies to media (artifact refs are materialized to committed paths *before* markdown is rendered — components/`.md` never see blob keys, A§1.6 steps 5–6).

### 4.3 Route files become thin loaders

```
src/pages/[...route].astro (per PageType):
  1. load derived Page JSON (content collection over src/data/site/pages/)
  2. gate on publication.published_time ≤ now — the exact gate blog.ts applies to
     posts today (A§2.5), extended uniformly to pages
  3. resolve refs (nav, taxonomy, queries, assets)
  4. <Layout site={ctx}> {page.sections.filter(visible).map(s =>
       <Registry[s.type] data={s.data} resolved={…} ctx={…} />)} </Layout>
```

Chrome (header/footer) is rendered by the same mechanism: `PageLayout` receives the Navigation *instances* named by `site.defaultNavigation`, overridden only by `page.navigationOverrides` — pure data override, one `Footer` component, one schema, two (or N) instances. This is the consolidation demanded by audit fork #6: the `Fragment slot="footer"` code fork (A§2.1) and the dual idioms (A§2.10) are both expressible only as data after this change. `Footer.astro` needs nearly zero work — the audit already established it is fully prop-driven (A§2.3); what changes is that *nothing else* is allowed to feed it except a published Navigation instance.

Existing AstroWind widgets and `dl-*` markup survive only as component implementations behind registry types; template-leftover pages (A§2.9) have no registry types and therefore no representation in the end state.

### 4.4 One renderer for public and preview

The audit flagged two renderers kept in sync by hand for articles (admin `node-renderer.ts` vs. public markdown pipeline, A§1.9). For Pages, the end state avoids ever creating that fork: the admin draft preview is a server-rendered route (`/admin/preview/{object_id}`, identity-gated) that reads the *draft* record from Blobs at request time and renders it through the **same** component registry used at build. Draft preview therefore differs from production only in data source, never in markup. (Feasibility of SSR-rendering Astro components inside a Netlify function/edge route is OQ-9; the architectural intent — one registry, two data sources — stands regardless of the exact rendering vehicle.) The article block editor keeps its DOM-level `node-renderer.ts` as an *editing affordance* (in-place TipTap overlays need DOM control, A§1.5); the article *preview* can migrate to the same SSR-preview route later, but that is not load-bearing for this design.

---

## 5. Cross-cutting designs

### 5.1 Identity & IDs

All object IDs are opaque, prefix-typed, and site-free (scoping note): no slugs, site names, or semantic words in IDs — extending the article node discipline (`n_*` opacity, A§1.1) uniformly. Slugs and routes are *fields* (renameable data), never identity.

### 5.2 Locking & concurrency (constraint honored)

Record-level lease, unchanged semantics: same `WorkflowLockRecord` shape, same 900 s default / 3600 s max lease, same 423 conflict + `force_release` + auto-refresh heartbeat + unload beacon (A§1.2), applied per *object*. A Page and everything inline in it = one lock (mirrors article-level decision). Shared Sections and Navigation instances are separate objects with separate locks — which is also the pressure valve: content that multiple editors/agents genuinely contend over should be factored into a shared object rather than motivating sub-object locks. **Sub-object locking (per-section-within-page, per-nav-item) is explicitly NOT designed; raised as OQ-1** per the session constraint.

### 5.3 Versioning & history

Unchanged from the audit's machinery: record `version` optimistic concurrency for humans and agents alike (409/`expected_record_version` on the patch path, 423 on the lock path — both already coexist, A§1.2), append-only `history` with structured `actor`. One addition: the `content_revision` counter (§3.1), bumped only by `body`-mutating writes. Review approvals pin `content_revision` (§3.9), which is the entire "approved-then-edited" invalidation mechanism — no snapshot store is introduced. Pinning the raw `version` would not work: lock operations bump `version` (A§1.2), and publishing requires the lock (§5.6 step 1), so an approval pinned to `version` would be invalidated by the publish flow itself. For the same reason, the publish operation's own writes to `publication.*` (timestamp stamp, receipt) are exempt from `content_revision`: publishing consumes an approval and must not invalidate it. Changing *when* something publishes is governed by the publish gate itself (roles + approval required to execute `publish`, §3.9/§5.6), not by re-review of content. The published state is recoverable from the derived export in git (which is versioned by git itself); a separate draft-snapshot/rollback store is deliberately out of scope.

### 5.4 Navigation & the footer fork (audit fork #6)

End state: exactly one Navigation schema (§3.8); instances `nav_header`, `nav_footer`, `nav_secondary`, `nav_social` are bound in `site.defaultNavigation`; a Page may reference a *different published Navigation instance* via `navigationOverrides` — and that is the only variation mechanism. The homepage's current divergent footer (A§2.1 vs A§2.3) maps to either (a) one merged `nav_footer` used everywhere, or (b) a second instance `nav_footer_home` referenced by the homepage Page record. **Which of (a)/(b) is an editorial content decision for Wolf at migration time (OQ-7)** — the architecture supports both as data, and neither as code.

### 5.5 Taxonomy (audit fork #3)

Resolved as one registry object (§3.7). Consequences, each grounded in the audit:

- **Source of truth:** the Taxonomy record in Blobs. The committed frontmatter strings become *outputs* validated at publish time (they remain physically in frontmatter because the public build derives routes from them, A§2.6 — but they can no longer say anything the registry doesn't).
- **The drift engine is removed:** `admin-taxonomy.ts`'s aggregation over blob drafts (A§2.11) is replaced by reading the registry; editor autocomplete and agent tooling consume the same terms.
- **No Topic entity** (audit: "topics == categories", A§2.7). Topic pages are a `listing` PageType over category terms; the term's `label`/`description` supply the presentation the topics index currently scrapes from post excerpts (A§2.7). If topics ever need independent curation (ordering, custom hero), that is a Page referencing a term — still not a new entity.
- Term renames/merges use stable `term_id` + `merged_into` so published frontmatter never breaks silently (deviation from today, where a category rename would strand old posts, A§2.6). **Resolution mechanism, made explicit because `ContentSourceV1` deliberately keeps free-string taxonomy** (§3.10 — `taxonomy.tags`, `publish_payload.category/tags` remain strings to protect the agent contract, A§1.1/A§1.8): at publish time (§5.6 step 2), each string is resolved against the registry *by slug, following `merged_into` aliases* — a deprecated slug resolves to its successor term rather than failing validation; only strings resolving to no term (even via aliases) are rejected. Step 3 then materializes the resolved terms' *current canonical slugs* into frontmatter (stale strings are normalized on every republish, not preserved), and step 5 records the resolved `term_id`s in the publish receipt on the envelope. The record's free strings are thus lossy input; the receipt's term IDs are the durable binding. The alternative — storing `term_id`s inside `ContentSourceV1` — is rejected in this pass because it changes the article schema agents already validate against (A§1.8); revisitable if alias-chain resolution proves fragile in practice.
- Multi-site-safe by construction (per-site record; no fixed vocabulary in code).

### 5.6 Publishing Workflow: one canonical semantics (audit fork #2)

**Canonical operation** (for every object type):

```
publish(object_id, published_time /* ISO | null | omitted=now */):
  1. require lock (or agent lock discipline) + publish role/policy (§3.9)
  2. validate body (registry/zod) + cross-references:
       taxonomy terms active (§5.5) · page/nav targets resolve · media artifacts
       materializable (exactly publish-article's current artifact validation, A§1.6)
  3. materialize the derived export(s) for this object + affected dependents,
       embedding the target timestamp (content_item → .md; everything else →
       src/data/site/*.json §1). The timestamp is an INPUT decided here; it is
       not yet recorded on the source record.
  4. commit via the existing GitHub Git Data API path (blobs→tree→commit→ref,
       publish-article.ts:1717-1768, A§1.6) — generalized into a shared materializer
  5. only after the commit succeeds: stamp publication.published_time AND write
       publish_receipt (deploy id/status) onto the record in a single write —
       the same export-first-then-stamp order the canonical article path uses
       today (publish-article executes, then set_published_time + receipt are
       written back, A§1.6)
unpublish ≡ publish(id, null): re-materializes (removes/neutralizes export), then stamps null
schedule  ≡ publish(id, future) — visibility gate at build handles the rest (§4.3; OQ-2)
```

Failure semantics of the ordering: a failure at or before step 4 leaves both the record and the repo unchanged — the record never claims a publish that didn't happen. A failure between steps 4 and 5 leaves the export committed but the record un-stamped: the residual window today's article path already has (A§1.6), and the safe direction — the source *under*-claims, and retrying is idempotent because re-publish overwrites the same export. The forbidden state (record stamped published, no committed export) cannot occur by construction.

Disposition of the three existing mechanisms (A§1.6):

1. **MCP `publish_by_time` (mechanism 2) is the canonical semantics**, generalized from articles to all object types. Its article-specific steps (agent-body promotion, featured-image scoring) become the `content_item` materializer's internals.
2. **The admin UI Publish button (mechanism 1) is folded in**: the endpoint behind the button executes the full canonical operation, not a bare `set_published_time`. Its current behavior — stamp only, then tell the human to trigger a deploy manually (A§1.6) — ceases to exist as a user-facing semantics. (`set_published_time` survives internally as the step-5 stamp/receipt write-back, preserving the agent contract, A§1.8.)
3. **`toggle-article-publish` (mechanism 3) is deprecated/legacy**: it rewrites derived frontmatter without touching the record (A§1.6), which under this architecture is a source-of-truth violation by definition (§1). The `/admin/library` toggle re-targets the canonical unpublish. The function is retained read-never/write-never in the end state (i.e., removed; listed here so the deprecation is explicit, not silent).

Invariant added: `publication.published_time` on the envelope and (for articles) `input.publication.published_time` are written together by step 5, only after a successful export commit; nothing else may write either. "Published" becomes one state with one writer — resolving the audit's "'published' is not a single state" observation (A§1.9). Companion invariant: the step-5 stamp/receipt write bumps `version` (every write does, A§1.2) but never `content_revision` (§3.1) — the operation that consumes an approval must not invalidate it.

### 5.7 Human Review (audit fork #4) & the default review mechanism

**Greenfield disclaimer, restated:** today there is no review model — an admin edits and publishes; the only "review" is the ephemeral Accept/Discard of AI suggestions plus the readiness gate (A§1.3, A§1.6). The design below is new.

Mechanism (default for every object type, per the session constraint):

- **In-place field diff for proposals** — the existing pattern verbatim: word-level diff for prose, side-by-side for short fields, Accept writes under lock via a node/section-scoped update endpoint, Discard writes nothing (A§1.3). Generalizes from article nodes to sections/nav items/terms because all are "small typed records with short prose fields" — the shape the diff UI was built for.
- **Draft-vs-published structural diff at publish time** — new but continuous with the readiness panel (A§1.6): before `publish`, the editor shows per-section/per-item diffs between the draft record and the last-published materialization, using the same diff components.
- **Approval state** on the envelope (§3.9) gates `publish` per policy. Approval pins `content_revision` (not `version` — see §3.1/§5.3); any later `body` write reopens review, while lock activity, review bookkeeping, and the publish operation's own publication stamps/receipts do not.
- **Ask-AI generalizes as-is**: the endpoint pattern (read-only, no lock, forced tool schema over the editable fields of the target, A§1.4) is reused per object type — the "editable public fields" for a section are its union `data` fields, defined by the registry schema (§3.5), so the forced-tool input schema is *generated from* the registry rather than maintained by hand (today it is hand-maintained in `admin-ask-ai-node.ts:97-119`, A§1.4).

Genuinely-different case (argued, per constraint): none identified that requires a different *mechanism*. What differs is *policy strictness* (site/nav/taxonomy require approval; articles keep it optional) and *blast-radius UX* (publishing navigation shows a "pages affected" list computed from references). Both are configuration of the same machinery.

### 5.8 Agent operability contract under dual auth (audit fork #5)

The contract extends the existing paired-endpoint reality (A§1.8) rather than assuming a unified identity layer:

- **Agents** reach objects through the MCP server / publish-key HTTP function with generic object verbs mirroring today's workflow verbs: `object_get`, `object_list`, `object_checkout` / `object_refresh_lock` / `object_checkin`, `object_patch` (with `expected_record_version`), `object_publish_by_time` — same names-and-discipline as `save_json_blob_*` (A§1.8), parameterized by `object_type`/`object_id`. Article-specific tools remain unchanged for compatibility.
- **Humans** reach the same records through identity-auth `admin-object-*` endpoints (the `admin-workflow-lock` / `admin-update-node` / `admin-patch-workflow` pattern generalized, A§1.2–1.3), so the browser continues never to hold the publish secret (the stated design rationale in `admin-workflow-lock.ts:2-5`, A§1.2).
- **Both principals share** the lock, version counter, history, and review state on the record — as human editors and agents already share the article lock today (A§1.2).
- Attribution for agents remains self-declared `agent_name` over the shared key (exactly today's trust model, A§1.2/A§1.8); tightening to per-agent credentials is OQ-3, and the `Principal.auth` field (§3.9) is designed so stronger attribution slots in without schema change.
- Policy hook: per §3.9, agents can be barred from `publish` on high-blast-radius types unless review is approved — enforced server-side where the key/token is verified, fitting both auth systems.

---

## 6. Multi-site safety (scoping note compliance)

Per concept, "safe by construction" = no single-site assumption in schema/IDs; "needs work" = a real dependency on per-deploy singletons.

| Concept | Multi-site status | Notes |
|---|---|---|
| Site | Safe by construction | It is the per-site root; N sites = N records. |
| Page / Template / Section | Safe by construction | `site` field on envelope; opaque IDs; no site names in keys. |
| PageType | Needs work later | Code registry shared across sites; per-site route patterns/policies would need a data layer. |
| Component Registry / Renderer | Needs work later | One codebase, one component set; per-site theming flows through `ctx` (tokens), but per-site *components* would need registry namespacing. |
| Content Item | Needs work later | Articles stay in the `workflows` store under site-free `req_*` keys with `ContentSourceV1` unchanged (§1, §3.10); the adapter stamps only a *default* `site`, and `publication_context` is publication/domain metadata, not a stable Site binding (A§1.1). Multi-site content queries, taxonomy validation, and publish materialization would need the adapter/migration to stamp a real per-record `site` — required work, not free. |
| Taxonomy | Safe by construction | Per-site record; no fixed vocabulary in code. |
| Navigation | Safe by construction | Per-site instances bound via Site. |
| Publishing Workflow | Needs work later | Bound to one `GITHUB_REPOSITORY`/branch per deploy (A§1.6); multi-site needs per-site repo/branch binding in Site body + credentials story. |
| Human Review / roles | Needs work later | Role maps are per-deploy env today (§3.9); per-site roles need the principals store (OQ-5). |
| Blob layout | Safe by construction | Keys carry no site name; `site` is a record field. A per-site store split is possible later without ID changes. |

---

## 7. Open questions (flagged, not silently answered)

- **OQ-1 — Sub-object locking.** Whole-record leases are the design (§5.2, per the audit's deliberate article-level decision, A§1.2). If concurrent editing *within* one page (human polishing hero while an agent updates the content grid) proves real, options are (a) factor contended sections into shared Section objects (works today, no new machinery), or (b) per-section leases inside the Page record (new machinery, new conflict UX). Needs product evidence before choosing (b).
- **OQ-2 — Scheduled publish requires a build at the scheduled time.** The visibility gate is build-time (A§2.5, §4.3); a future `published_time` only goes live when something rebuilds the site. Today articles have the same latent issue (A§1.7). Options: Netlify scheduled builds/build hooks, or a scheduler function. Unresolved; affects ops more than schema.
- **OQ-3 — Per-agent credentials.** Shared `x-publish-key` + self-declared `agent_name` is today's trust model (A§1.8). Per-agent tokens (or scoped MCP tokens) would make `Principal` attribution real and enable per-agent policy. Schema is ready (§3.9); the credential/rotation story is not designed.
- **OQ-4 — PageType: code registry vs. blob object.** Chosen as code (§3.4) because it binds to route files/loaders. If Wolf wants agents to *create new page types* (not just pages), that forces a data-driven route layer — significant work, deliberately not designed here.
- **OQ-5 — Where role assignments live.** Env allowlists (minimal extension of `ADMIN_EMAILS`, A§2.12) vs. a principals object in Blobs (auditable, multi-site-ready, but security-sensitive data in the content store). Leaning env for the single-site present; unresolved.
- **OQ-6 — Persisted change proposals.** Today, agent writes land directly in the draft under lock, and AI suggestions are ephemeral browser state (A§1.3–1.4). A persisted "proposal" object (agent suggests → human reviews later, asynchronously) would improve agent/human asynchrony but adds a parallel write path and merge questions. Not designed; the review mechanism (§5.7) is compatible with adding it later.
- **OQ-7 — Homepage footer content reconciliation.** Merge to one footer vs. keep a second instance (§5.4) — editorial decision, not architectural.
- **OQ-8 — Physical home of article records.** Keep articles in the `workflows` store under existing keys (zero agent-contract disruption) vs. migrate into `site-objects` (uniformity). Envelope compatibility makes both viable; migration mechanics are a later-session topic.
- **OQ-9 — SSR draft preview vehicle.** One-registry preview (§4.4) wants server-side rendering of Astro components with draft data inside a Netlify function/edge context. Feasibility (Astro container API maturity, cold-start cost) unverified — flagged rather than assumed.
- **OQ-10 — Decap CMS removal.** The vestigial, mis-pointed Decap install (A§2.12) has no role in this architecture; formally removing it (and its git-gateway implications) should be confirmed with Wolf rather than assumed.

---

## 8. Concept-by-concept: extends vs. replaces (compliance index)

| Concept | Extends (from audit) | Replaces / retires |
|---|---|---|
| Site | Blob→derived-export pattern (A§1.7); `astrowind:config` injection plumbing (A§2.10) | Hand-edited `config.yaml` values; `CustomStyles.astro` hardcoded tokens; `Logo.astro` literal (A§2.13) |
| Page | `WorkflowRecord` envelope + lock/history/version (A§1.1–1.2) | Hardcoded page `.astro` files (A§2.1, A§2.9); `<Fragment slot>` overrides (A§2.1) |
| PageType | Informal repeated layouts; listing static-path generators (A§2.5, A§2.10) | The two ad-hoc idioms as *authoring* mechanisms (A§2.10) |
| Template | `input-bank` blueprint-stamping model (A§1.1) | Nothing (no template system exists, A§2.10) |
| Section | Node envelope discipline: opaque IDs, visibility, never-render-private (A§1.1) | Combinatorial typing *for pages only* (§2.5); inline const-array content (A§2.1) |
| Component/Registry | Prop-driven widget pattern (Footer already pure, A§2.3) | Three-way input-bank/node-renderer/to-markdown agreement *for sections* (A§1.9); components importing config/nav (A§2.2) |
| Renderer | Build-time static model + published_time gate (A§1.7, A§2.5) | Duplicated admin preview renderer (A§1.9), via §4.4/OQ-9 |
| Content Item | ContentSourceV1 + article_body.v1 verbatim (A§1.1) | Nothing — schema unchanged |
| Taxonomy | Publish-time validation point (A§1.6) | Free-string vocabulary (A§2.6); `admin-taxonomy` drift aggregation (A§2.11); implied Topic entity (A§2.7) |
| Navigation | `headerData`/`footerData` shapes (A§2.2–2.3) | `navigation.ts` as source; homepage footer code fork (A§2.1) |
| Publishing Workflow | `publish_by_time` semantics + Git Data API materializer + receipts (A§1.6) | UI stamp-only publish; `toggle-article-publish` frontmatter rewrite (A§1.6) |
| Human Review | Diff overlay + Accept/Discard + readiness gate as UI vocabulary (A§1.3, A§1.6) | Nothing — greenfield (A§2.12), stated as such |
