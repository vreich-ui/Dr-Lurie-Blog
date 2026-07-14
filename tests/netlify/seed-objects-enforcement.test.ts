import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildStoreValidationContext } from '../../netlify/lib/object-validation-context.js';
import { summarizeValidation, validateObject } from '../../netlify/lib/object-validate.js';
import type { ObjectType } from '../../src/schema/object-record-v1.js';

// Every committed derived export is a body that the production publish will
// re-validate under the now-LIVE resolvers (Part B). This guards that wiring
// enforcement did not retroactively invalidate known-good seed data: each
// export must validate with ZERO blockers when the whole set is present in the
// store (so cross-object references resolve). Directory → object type.
// (The compiled test runs from a temp dir, so ascend to the repo root.)
const findSiteData = (): string => {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = join(dir, 'src', 'data', 'site');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error('could not locate src/data/site');
};
const SITE_DATA = findSiteData();
const DIRS: Array<{ dir: string; type: ObjectType }> = [
  { dir: join(SITE_DATA, 'pages'), type: 'page' },
  { dir: join(SITE_DATA, 'sections'), type: 'section' },
  { dir: join(SITE_DATA, 'navigation'), type: 'navigation' },
  // Templates too, so a committed page's `template.ref` resolves (the whole set
  // must be present for cross-object references to validate).
  { dir: join(SITE_DATA, 'templates'), type: 'template' },
  // Section-template exports (W8.1) — the dir holds only .gitkeep until the
  // W8.4 credentialed run publishes the first recipes; missing/empty is fine.
  { dir: join(SITE_DATA, 'section-templates'), type: 'section_template' },
  // Product exports (S2 onward) — the dir is absent until the first product
  // publishes; the loader skips missing dirs.
  { dir: join(SITE_DATA, 'products'), type: 'product' },
];

const stripGenerated = (data: Record<string, unknown>): Record<string, unknown> => {
  const { __generated, ...body } = data;
  void __generated;
  return body;
};

type SeedObject = { type: ObjectType; id: string; body: Record<string, unknown> };

const loadSeedObjects = async (): Promise<SeedObject[]> => {
  const objects: SeedObject[] = [];
  for (const { dir, type } of DIRS) {
    let files: string[] = [];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    } catch {
      continue;
    }
    for (const file of files) {
      const data = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>;
      objects.push({ type, id: file.replace(/\.json$/, ''), body: stripGenerated(data) });
    }
  }
  return objects;
};

// An in-memory store presenting every seed object as a published record.
const makeStore = (objects: SeedObject[]) => {
  const blobs = new Map<string, string>();
  for (const o of objects) {
    blobs.set(
      `objects/${o.type}/by-id/${o.id}.json`,
      JSON.stringify({
        object_id: o.id,
        object_type: o.type,
        body: o.body,
        publication: { published_time: '2026-01-01T00:00:00.000Z' },
      })
    );
  }
  return {
    async get(key: string) {
      return blobs.get(key) ?? null;
    },
    async list({ prefix }: { prefix: string }) {
      return { blobs: [...blobs.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), directories: [] };
    },
    async setJSON() {},
  } as never;
};

test('every committed object export validates with zero blockers under the live resolvers', async () => {
  const objects = await loadSeedObjects();
  assert.ok(objects.length >= 10, 'expected the seeded page/section/nav exports to be present');
  const store = makeStore(objects);

  for (const o of objects) {
    const context = await buildStoreValidationContext(store, { selfObjectId: o.id, selfObjectType: o.type });
    // publishIntent:true — the strictest gate (publish-time), the real bar.
    const groups = validateObject(
      { objectType: o.type, objectId: o.id, body: o.body, published: true },
      { ...context, publishIntent: true }
    );
    const summary = summarizeValidation(groups);
    assert.deepEqual(
      summary.blockers.map((b) => `${b.id}: ${b.message}`),
      [],
      `${o.type} ${o.id} must have zero blockers at publish`
    );
  }
});
