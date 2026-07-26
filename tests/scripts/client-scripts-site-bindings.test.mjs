/**
 * W14 T14.0 — client-bundle site-binding lint (admin-login regression guard).
 *
 * W11 T11.5 made the GoTrue localStorage keys (and the edit-mode media policy)
 * resolve through the provider seams in `packages/core/lib/site-identity.ts` /
 * `media-policy.ts`. Those seams THROW until a site registers its providers via
 * `src/config/policy-bindings`. Every consumer of `goTrueClient` wraps its
 * storage access in `try/catch`, so an unregistered provider does not surface as
 * an error — it degrades silently to "always signed out": a valid session is
 * never read, and a successful sign-in is never persisted.
 *
 * Astro compiles each `<script>` block in a `.astro` file as its own client
 * entry. An entry only gets the registration if IT imports the bindings — being
 * on the same page as a React island that does is a hydration-order race, not a
 * guarantee (that race is exactly how `/admin` regressed: sign-in appeared to
 * work once, then every reload showed the signed-out gate again).
 *
 * The rule this locks in: a client `<script>` block that reaches an
 * identity-dependent core module must import the site policy bindings in the
 * same block. Frontmatter (server-side, `---` fenced) is out of scope — Astro
 * renders it in a Node context whose entry has already registered the
 * providers.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'src');

/** Core modules that resolve site identity / policy through a provider seam. */
const IDENTITY_DEPENDENT = ['@core/lib/admin/goTrueClient', '@core/lib/edit-mode/index', '@core/lib/site-identity'];

const BINDINGS = '~/config/policy-bindings';

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.astro')) out.push(p);
  }
  return out;
};

/** Everything after the closing frontmatter fence (or the whole file if none). */
const templateBody = (source) => {
  if (!source.startsWith('---')) return source;
  const end = source.indexOf('\n---', 3);
  return end === -1 ? '' : source.slice(end + 4);
};

/** The inner text of every `<script>` block that Astro bundles for the client. */
const clientScriptBlocks = (source) => {
  const blocks = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(templateBody(source))) !== null) {
    const attrs = m[1];
    // `is:inline` scripts are emitted verbatim — Vite never bundles them, so
    // they cannot import anything and are not in scope for this rule.
    if (/\bis:inline\b/.test(attrs)) continue;
    if (/\bsrc=/.test(attrs)) continue;
    blocks.push(m[2]);
  }
  return blocks;
};

const importsModule = (block, specifier) => block.includes(`'${specifier}'`) || block.includes(`"${specifier}"`);

test('client <script> blocks that reach identity-dependent core modules import the site policy bindings', () => {
  const offenders = [];
  for (const file of walk(SRC)) {
    const source = readFileSync(file, 'utf8');
    clientScriptBlocks(source).forEach((block, index) => {
      const reached = IDENTITY_DEPENDENT.filter((specifier) => importsModule(block, specifier));
      if (reached.length === 0) return;
      if (importsModule(block, BINDINGS)) return;
      offenders.push(
        `${file.slice(ROOT.length + 1)} <script> #${index}: imports ${reached.join(', ')} without ${BINDINGS}`
      );
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `client scripts reach site-identity without registering the site providers ` +
      `(silently degrades to "always signed out"):\n${offenders.join('\n')}`
  );
});

test('the rule actually fires — a script importing goTrueClient with no bindings is an offence', () => {
  const bad = `---\n---\n<script>\n  import { currentUser } from '@core/lib/admin/goTrueClient';\n  currentUser();\n</script>\n`;
  const blocks = clientScriptBlocks(bad);
  assert.equal(blocks.length, 1);
  assert.ok(importsModule(blocks[0], '@core/lib/admin/goTrueClient'));
  assert.ok(!importsModule(blocks[0], BINDINGS));

  const good = `---\n---\n<script>\n  import '~/config/policy-bindings';\n  import { currentUser } from '@core/lib/admin/goTrueClient';\n</script>\n`;
  assert.ok(importsModule(clientScriptBlocks(good)[0], BINDINGS));
});

test('frontmatter imports are out of scope (server-side render path)', () => {
  const frontmatterOnly = `---\nimport { getSiteIdentity } from '@core/lib/site-identity';\n---\n<p>{getSiteIdentity().brandName}</p>\n`;
  assert.deepEqual(clientScriptBlocks(frontmatterOnly), []);
});

test('is:inline scripts are out of scope (never bundled, cannot import)', () => {
  const inline = `---\n---\n<script is:inline>\n  window.x = '@core/lib/admin/goTrueClient';\n</script>\n`;
  assert.deepEqual(clientScriptBlocks(inline), []);
});
