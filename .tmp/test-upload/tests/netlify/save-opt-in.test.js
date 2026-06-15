import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecord, isParseBodyFailure, parseBody } from '../../netlify/lib/opt-in-record.js';
test('URL-encoded Netlify form-name payload builds a valid opt-in record', () => {
    const input = parseBody({
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            'form-name': 'free-guide',
            email: 'reader@example.com',
            name: 'Reader',
            pathname: '/free-guide',
            consentText: 'I agree to receive updates.',
        }).toString(),
    });
    assert.ok(input);
    if (isParseBodyFailure(input)) {
        assert.fail('Expected a parsed URL-encoded input object.');
    }
    assert.deepEqual(input['form-name'], 'free-guide');
    const record = buildRecord(input, 'node-test-agent');
    assert.ok(record);
    assert.equal(record.formName, 'free-guide');
    assert.equal(record.email, 'reader@example.com');
    assert.equal(record.name, 'Reader');
    assert.equal(record.source, '/free-guide');
    assert.equal(record.consent, 'I agree to receive updates.');
    assert.equal(record.userAgent, 'node-test-agent');
    assert.match(record.submittedAt, /^\d{4}-\d{2}-\d{2}T/);
});
test('JSON formName payload remains the preferred contract', () => {
    const input = parseBody({
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            formName: 'newsletter',
            'form-name': 'free-guide',
            email: 'json@example.com',
        }),
    });
    assert.ok(input);
    if (isParseBodyFailure(input)) {
        assert.fail('Expected a parsed JSON input object.');
    }
    const record = buildRecord(input);
    assert.ok(record);
    assert.equal(record.formName, 'newsletter');
    assert.equal(record.email, 'json@example.com');
});
test('malformed JSON returns a typed parse failure without throwing', () => {
    const input = parseBody({
        headers: { 'content-type': 'application/json' },
        body: '{not json',
    });
    assert.deepEqual(input, { ok: false, reason: 'malformed-json' });
    assert.equal(isParseBodyFailure(input), true);
});
