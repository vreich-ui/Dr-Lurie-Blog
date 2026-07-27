#!/usr/bin/env node
/**
 * W14 T14.5 — the instruction-manual drive.
 *
 * Authors the platform site's user manual AS OBJECTS through the site's own
 * MCP endpoint — the same front door every agent uses. One reference page per
 * governed type plus lifecycle / roles / genesis / index pages, each a `page`
 * object with prose sections, published and released like any other content.
 *
 * The reference half of every type page is GENERATED from that type's live
 * `object_contract` — permitted patch ops, lifecycle verbs, publish policy,
 * body fields — which is what makes the manual drift-proof: `--check`
 * regenerates from the live contract and diffs against the committed exports,
 * failing on any mismatch. Prose intros are curated; contract facts are never
 * hand-typed.
 *
 * Usage:
 *   MCP_KEY=… node scripts/platform-manual-drive.mjs --endpoint https://<site>/mcp          # create/update + publish
 *   MCP_KEY=… node scripts/platform-manual-drive.mjs --endpoint https://<site>/mcp --check  # drift guard only
 *
 * The key is the site's MCP_HTTP_AUTH_TOKEN, always from env, never an
 * argument (argv leaks into shell history and process lists).
 */

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : (args[index + 1] ?? true);
};
const ENDPOINT = flag('--endpoint');
const CHECK_ONLY = args.includes('--check');
const KEY = process.env.MCP_KEY;
if (!ENDPOINT || !KEY) {
  console.error('usage: MCP_KEY=… node scripts/platform-manual-drive.mjs --endpoint https://<site>/mcp [--check]');
  process.exit(2);
}

let rpcId = 0;
const rpc = async (method, params) => {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const body = await response.json();
  return body.result ?? body;
};
const tool = async (name, toolArgs) => {
  const result = await rpc('tools/call', { name, arguments: toolArgs ?? {} });
  return { isError: Boolean(result.isError), data: result.structuredContent ?? {} };
};

const AGENT = 'object-conversion-roundtrip';
// The prose vocabulary requires ABSOLUTE http(s) hrefs, so manual cross-links
// are built from the endpoint's origin — per-site correct by construction.
const ORIGIN = new URL(ENDPOINT).origin;
const SITE = 'site_platform';

const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Conform prose to the RichText allowlist (p,br,strong,em,a,ul,ol,li,h2,h3;
 * absolute http(s) hrefs only): <code>/<pre> become <strong>, root-relative
 * hrefs gain this site's origin.
 */
const conform = (html) =>
  html
    .replaceAll('<code>', '<strong>')
    .replaceAll('</code>', '</strong>')
    .replaceAll('<pre>', '<p>')
    .replaceAll('</pre>', '</p>')
    .replace(/href="\//g, `href="${ORIGIN}/`);

// ─── contract → reference prose ──────────────────────────────────────────────

const opRow = (op) => {
  const description = op.arg_schema?.description ?? '';
  return `<li><strong>${esc(op.op)}</strong>${description ? ` — ${esc(description)}` : ''}</li>`;
};

const typeReferenceBody = (contract) => {
  const bodySchema = contract.body_schema ?? {};
  const properties = Object.keys(bodySchema.properties ?? {});
  const required = new Set(bodySchema.required ?? []);
  const fieldList = properties
    .map((name) => `<li><strong>${esc(name)}</strong>${required.has(name) ? ' <em>(required)</em>' : ''}</li>`)
    .join('');
  const ops = (contract.patch_ops ?? []).map(opRow).join('');
  const lifecycle = (contract.lifecycle_verbs ?? contract.verbs ?? [])
    .map((verb) => `<li><strong>${esc(typeof verb === 'string' ? verb : (verb.verb ?? ''))}</strong></li>`)
    .join('');
  const workflows = (contract.workflows ?? [])
    .map((entry) => {
      const publish = entry.publish ?? entry;
      const roles = publish.publishRoles ? ` Publish roles: ${esc(publish.publishRoles.join(', '))}.` : '';
      const approvals = publish.minApprovals !== undefined ? ` Minimum approvals: ${esc(publish.minApprovals)}.` : '';
      return roles || approvals ? `<li>${roles}${approvals}</li>` : '';
    })
    .join('');
  return (
    `<h2>Body fields</h2><ul>${fieldList || '<li>(none)</li>'}</ul>` +
    `<h2>Patch operations</h2><ul>${ops || '<li>(none — this type is edited through dedicated tools)</li>'}</ul>` +
    (lifecycle ? `<h2>Lifecycle verbs</h2><ul>${lifecycle}</ul>` : '') +
    (workflows ? `<h2>Publish policy</h2><ul>${workflows}</ul>` : '') +
    `<p><em>This reference is generated from the live <code>object_contract</code>. ` +
    `If it disagrees with the contract, the manual is wrong and the drift guard fails the build of it.</em></p>`
  );
};

// Curated intros — what each type IS and what it is used as. Facts below each
// intro come from the contract, never from here.
const TYPE_INTROS = {
  page: 'A page is a routed surface: a route, a title, SEO, and an ordered list of sections. Agents create pages, compose them from sections, and publish them; a published page whose route no code file owns is served automatically.',
  section:
    'A section is a reusable content block a page renders — prose, heroes, grids, CTAs. Shared sections are referenced from multiple pages by id; editing the object updates every page that references it.',
  navigation:
    'A navigation object is a menu — header or footer — of groups and items. The site singleton names which navigation objects are its defaults.',
  taxonomy:
    'The taxonomy registry is the site’s curated vocabulary: categories and tags agents may use. Content referencing an unknown term fails validation instead of minting vocabulary by accident.',
  site: 'The site singleton is this deployment’s identity: name, logo, metadata defaults, brand tokens, default navigation, and blog configuration. One per site; its palette changes only through theme application.',
  template: 'A template is a page blueprint: slots an agent fills to stamp out a page with the right structure.',
  section_template:
    'A section template is a recipe for a section: canonical structure plus neutral starter copy, stamped standalone or straight into a page.',
  theme:
    'A theme is a named palette and font set. Applying a theme to the site is an atomic, reversible operation and the only sanctioned way to change brand tokens.',
  product:
    'A product is a sellable item: pricing, availability, and copy. Price changes go through a dedicated privileged operation, never a generic field patch.',
  // Careful wording: the reader-safety scan forbids certain literal tokens
  // (assert-reader-safe.ts) in ANY reader-facing prose — including the words
  // this type's own documentation most wants to use. Say it without them.
  content_item:
    'A content item is an article in the annotated-node model: every block pairs its reader-facing body with editorial annotations the reader never sees. The published page renders only the projection.',
  tracking_config:
    'The tracking registry is the site’s single analytics/consent configuration. Agents edit the singleton; they never create a second one.',
};

const MANUAL_PAGES = (contracts) => {
  const typePages = Object.entries(contracts).map(([objectType, contract]) => ({
    id: `page_manual_${objectType}`,
    route: `/manual/types/${objectType.replaceAll('_', '-')}`,
    title: `Manual — ${objectType}`,
    description: `Reference for the ${objectType} object type: fields, operations, publish policy.`,
    sections: [
      { id: 's_intro', type: 'prose', data: { body: `<p>${esc(TYPE_INTROS[objectType] ?? '')}</p>` } },
      { id: 's_reference', type: 'prose', data: { body: typeReferenceBody(contract) } },
    ],
  }));

  return [
    {
      id: 'page_manual',
      route: '/manual',
      title: 'Platform manual',
      description: 'How this publishing system works: objects, lifecycle, roles, and how a site is born.',
      sections: [
        {
          id: 's_index',
          type: 'prose',
          data: {
            body:
              '<h2>How this system works</h2>' +
              '<p>Everything on every site is an <strong>object</strong> in a governed store, edited through one MCP contract. ' +
              'This manual is itself made of those objects, published through the same front door agents use.</p>' +
              '<ul>' +
              '<li><a href="/manual/lifecycle">The object lifecycle</a> — checkout, patch, publish, release.</li>' +
              '<li><a href="/manual/roles">Roles and access</a> — who may do what, and how it is enforced.</li>' +
              '<li><a href="/manual/genesis">How a site is born</a> — from one command to a live tenant.</li>' +
              '</ul>' +
              '<h2>Type reference</h2><ul>' +
              Object.keys(contracts)
                .map((t) => `<li><a href="/manual/types/${t.replaceAll('_', '-')}">${esc(t)}</a></li>`)
                .join('') +
              '</ul>',
          },
        },
      ],
    },
    {
      id: 'page_manual_lifecycle',
      route: '/manual/lifecycle',
      title: 'Manual — the object lifecycle',
      description: 'Checkout, patch, publish, release: how a change becomes live.',
      sections: [
        {
          id: 's_lifecycle',
          type: 'prose',
          data: {
            body:
              '<h2>One lifecycle for everything</h2>' +
              '<ol>' +
              '<li><strong>checkout</strong> — take a 15-minute lease on the object. One writer at a time; the lease expires on its own if a session dies.</li>' +
              '<li><strong>patch</strong> — apply typed operations (each with an exact inverse) under the lease, carrying the expected record version so concurrent edits fail loudly instead of merging silently.</li>' +
              '<li><strong>validate</strong> — every write runs the validation engine: schema, safety, reference integrity, structural invariants. A publish-blocking criterion refuses the publish, not the draft.</li>' +
              '<li><strong>publish</strong> — the record becomes the published revision and its derived export is committed to the repo (with <code>[skip netlify]</code> — publishing does not deploy).</li>' +
              '<li><strong>release</strong> — one build of the accumulated exports; the release verifies the deploy went live before reporting success.</li>' +
              '</ol>' +
              '<p>Store reads are eventually consistent on this runtime: a dependent read moments after a write may briefly see the previous state. Drives that chain dependent writes wait and retry.</p>',
          },
        },
      ],
    },
    {
      id: 'page_manual_roles',
      route: '/manual/roles',
      title: 'Manual — roles and access',
      description: 'Principals, keys, and policy: who may do what.',
      sections: [
        {
          id: 's_roles',
          type: 'prose',
          data: {
            body:
              '<h2>Principals</h2>' +
              '<ul>' +
              '<li><strong>Humans</strong> sign in through Identity; Owner and Admin are resolved server-side, and owner-only surfaces 403 regardless of what the UI shows.</li>' +
              '<li><strong>Agents</strong> authenticate to <code>/mcp</code> with the site’s key or their own per-agent key; per-agent keys make attribution verified instead of self-declared.</li>' +
              '</ul>' +
              '<h2>Policy</h2>' +
              '<ul>' +
              '<li><strong>Creation policy</strong> — who may mint objects of each type. Singletons such as the tracking registry are seed-minted only.</li>' +
              '<li><strong>Approval policy</strong> — which types publish autonomously and which require a human. Commerce requires approval by default: proposing a price is fine, a price going live unseen is not.</li>' +
              '<li>Both are committed per-site config: reviewable, versioned, and identical in kind across the fleet while differing in values.</li>' +
              '</ul>',
          },
        },
      ],
    },
    {
      id: 'page_manual_genesis',
      route: '/manual/genesis',
      title: 'Manual — how a site is born',
      description: 'From one command to a live tenant.',
      sections: [
        {
          id: 's_genesis',
          type: 'prose',
          data: {
            body:
              '<h2>Genesis</h2>' +
              '<ol>' +
              '<li><code>create-site --name &lt;client&gt;</code> scaffolds the site directory: config bundle, build entry, function shims, seeds, and bootstrap exports that let the site build before any object exists.</li>' +
              '<li>The credentialed half provisions the Netlify project, links the repo, and sets the env — including the generated secrets and the site id the blob runtime keys on.</li>' +
              '<li>The seed drive creates the starter pack through <code>/mcp</code> in dependency order: <strong>navigation first, then the site singleton</strong> (its default-navigation references must resolve), then pages, taxonomy, theme, and recipes.</li>' +
              '<li>Publishing each object replaces its bootstrap stub with a genuine derived export; one release makes the site render from real objects.</li>' +
              '</ol>' +
              '<p>Every site is a thin entry over the same shell and engine. Fixing the engine fixes every site; a client’s content, policies, and workflows are data, never forked code.</p>',
          },
        },
      ],
    },
    ...typePages,
  ];
};

// ─── drive ───────────────────────────────────────────────────────────────────

const objectTypes = [
  'page',
  'section',
  'navigation',
  'taxonomy',
  'site',
  'template',
  'section_template',
  'theme',
  'product',
  'content_item',
  'tracking_config',
];

const main = async () => {
  const contracts = {};
  for (const objectType of objectTypes) {
    const { isError, data } = await tool('object_contract', { object_type: objectType });
    if (isError) throw new Error(`object_contract(${objectType}) failed: ${JSON.stringify(data).slice(0, 200)}`);
    contracts[objectType] = data.contract ?? data;
  }
  const pages = MANUAL_PAGES(contracts);

  let drift = 0;
  for (const page of pages) {
    const body = {
      pageType: 'system',
      route: page.route,
      title: page.title,
      seo: { description: page.description, robots: { index: false, follow: false } },
      sections: page.sections.map((section) => ({
        ...section,
        data: { ...section.data, body: conform(section.data.body) },
      })),
    };

    const existing = await tool('object_get', { object_type: 'page', object_id: page.id });
    const record = existing.isError ? undefined : existing.data.record;

    if (CHECK_ONLY) {
      if (!record) {
        console.log(`DRIFT ${page.id}: missing from the store`);
        drift += 1;
        continue;
      }
      const live = JSON.stringify(record.body?.sections ?? []);
      const expected = JSON.stringify(body.sections);
      if (live !== expected) {
        console.log(`DRIFT ${page.id}: sections differ from the live contract`);
        drift += 1;
      } else {
        console.log(`ok    ${page.id}`);
      }
      continue;
    }

    if (!record) {
      const created = await tool('object_create', {
        object_type: 'page',
        site: SITE,
        requested_id: page.id,
        agent_name: AGENT,
        body,
      });
      console.log(
        `${created.isError ? 'FAIL create ' : 'created '}${page.id}`,
        created.isError ? JSON.stringify(created.data).slice(0, 180) : ''
      );
      if (created.isError) continue;
    } else {
      // Update through the front door: checkout → set_page_meta + section update.
      const checkout = await tool('object_checkout', { object_type: 'page', object_id: page.id, agent_name: AGENT });
      const lock = checkout.data.lockToken;
      if (!lock) {
        console.log(`LOCKED ${page.id} — skipped this pass`);
        continue;
      }
      const version = record.version;
      const ops = [
        { op: 'set_page_meta', fields: { title: page.title, seo: body.seo } },
        ...page.sections.map((section) => ({ op: 'update_section_data', section_id: section.id, data: section.data })),
      ];
      const patched = await tool('object_patch', {
        object_type: 'page',
        object_id: page.id,
        lock_token: lock,
        agent_name: AGENT,
        expected_record_version: version,
        ops,
      });
      if (patched.isError) {
        console.log(`FAIL patch ${page.id}`, JSON.stringify(patched.data).slice(0, 180));
        await tool('object_discard', { object_type: 'page', object_id: page.id, lock_token: lock, agent_name: AGENT });
        continue;
      }
      console.log(`updated ${page.id}`);
      const published = await tool('object_publish', {
        object_type: 'page',
        object_id: page.id,
        lock_token: lock,
        agent_name: AGENT,
      });
      console.log(
        `${published.isError ? 'FAIL publish ' : 'published '}${page.id}`,
        published.isError ? JSON.stringify(published.data).slice(0, 180) : ''
      );
      // Publish does NOT release the lock — check in, or the next pass
      // (and any other agent) is locked out for the full 15-minute lease.
      await tool('object_checkin', { object_type: 'page', object_id: page.id, lock_token: lock, agent_name: AGENT });
      continue;
    }

    // Fresh object: publish under a fresh lock.
    const checkout = await tool('object_checkout', { object_type: 'page', object_id: page.id, agent_name: AGENT });
    const lock = checkout.data.lockToken;
    if (!lock) {
      console.log(`LOCKED ${page.id} after create — publish next pass`);
      continue;
    }
    const published = await tool('object_publish', {
      object_type: 'page',
      object_id: page.id,
      lock_token: lock,
      agent_name: AGENT,
    });
    console.log(
      `${published.isError ? 'FAIL publish ' : 'published '}${page.id}`,
      published.isError ? JSON.stringify(published.data).slice(0, 220) : ''
    );
    if (published.isError) {
      await tool('object_discard', { object_type: 'page', object_id: page.id, lock_token: lock, agent_name: AGENT });
    }
    // See above: publish keeps the lock; release it explicitly.
    await tool('object_checkin', { object_type: 'page', object_id: page.id, lock_token: lock, agent_name: AGENT });
  }

  if (CHECK_ONLY) {
    if (drift > 0) {
      console.error(`[manual-drive] DRIFT: ${drift} page(s) out of step with the live contract.`);
      process.exit(1);
    }
    console.log('[manual-drive] drift check clean.');
    return;
  }

  const release = await tool('release_to_production', { agent_name: AGENT });
  console.log('release:', JSON.stringify(release.data).slice(0, 200));
};

main().catch((error) => {
  console.error('[manual-drive] failed:', error.message);
  process.exit(1);
});
