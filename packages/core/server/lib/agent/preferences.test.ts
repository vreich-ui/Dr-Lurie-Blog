import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  addPostEditDelta,
  createPreferenceEvent,
  exportPreferencePairs,
  sanitizeLearningValue,
} from './preferences.js';
import type { CandidateOption } from './candidates.js';

const memoryStore = () => {
  const blobs = new Map<string, string>();
  return {
    blobs,
    async get(key: string) {
      return blobs.get(key) ?? null;
    },
    async setJSON(key: string, value: unknown) {
      blobs.set(key, JSON.stringify(value));
    },
    async list({ prefix }: { prefix: string }) {
      return { blobs: [...blobs.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
};

const candidates: CandidateOption[] = ['A', 'B', 'C'].map((content, index) => {
  const id = String.fromCharCode(97 + index);
  return {
    candidate_id: id,
    label: content,
    content: `Version ${content}`,
    self_description: `${content} approach`,
    target: { id: `call_${id}`, name: 'patch', args: { ops: [{ op: 'safe' }] } },
  };
});

describe('learning preference evidence', () => {
  it('exports one CMS-Agent-shaped pair per rejected candidate', async () => {
    const store = memoryStore();
    const saved = await createPreferenceEvent(store, {
      at: '2026-08-07T12:00:00.000Z',
      site: 'site_test',
      chat_id: 'obj:page_test',
      run_id: 'run_1',
      object_id: 'page_test',
      object_type: 'page',
      focus: 'Homepage → Hero',
      prompt_context: 'Rewrite the hero.',
      candidates,
      chosen_id: 'b',
      editor_email: 'editor@example.com',
      profile_id: 'prof_1',
      model: 'internal-model',
    });
    await addPostEditDelta(store, saved.key, { private: { strategy: 'never export' }, text: 'B' }, { text: 'B+' });
    const exported = await exportPreferencePairs(store);
    assert.strictEqual(exported.count, 2);
    const lines = exported.jsonl.split('\n').map((line) => JSON.parse(line));
    assert.deepStrictEqual(Object.keys(lines[0]).sort(), ['chosen', 'metadata', 'prompt', 'rejected']);
    assert.strictEqual(JSON.parse(lines[0].chosen), 'Version B');
    assert.doesNotMatch(exported.jsonl, /never export|internal-model/);
  });

  it('keeps none-of-these choices as hard negatives without inventing a chosen pair', async () => {
    const store = memoryStore();
    await createPreferenceEvent(store, {
      at: '2026-08-07T12:00:00.000Z',
      site: 'site_test',
      chat_id: 'obj:page_test',
      run_id: 'run_2',
      prompt_context: 'Try again.',
      candidates,
      chosen_id: null,
      none_reason: 'Too promotional.',
      editor_email: 'editor@example.com',
      profile_id: 'prof_1',
      model: 'internal-model',
    });
    const exported = await exportPreferencePairs(store);
    assert.strictEqual(exported.count, 0);
    assert.strictEqual(exported.hard_negatives, 3);
  });

  it('recursively excludes private and credential-shaped keys', () => {
    assert.deepStrictEqual(
      sanitizeLearningValue({ text: 'safe', private: { strategy: 'hidden' }, nested: { access_token: 'secret' } }),
      { text: 'safe', nested: {} }
    );
  });
});
