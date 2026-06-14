import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import sharp from 'sharp';

import { validateUploadImages } from '../../scripts/validate-upload-images.mjs';

const createImageBytes = (format) => {
  const image = sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 80, g: 100, b: 120 },
    },
  });

  if (format === 'jpeg') return image.jpeg().toBuffer();
  if (format === 'webp') return image.webp().toBuffer();
  return image.png().toBuffer();
};

test('validate-upload-images reports corrupt and extension-mismatched uploads', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'upload-image-validation-'));

  try {
    await writeFile(path.join(root, 'valid.png'), await createImageBytes('png'));
    await writeFile(path.join(root, 'corrupt.webp'), Buffer.from('not an image'));
    await writeFile(path.join(root, 'mismatch.png'), await createImageBytes('jpeg'));
    await writeFile(path.join(root, 'ignored.gif'), Buffer.from('not checked'));

    const result = await validateUploadImages(root);

    assert.deepEqual(result.files.map((file) => path.basename(file)).sort(), [
      'corrupt.webp',
      'mismatch.png',
      'valid.png',
    ]);
    assert.equal(result.invalid.length, 2);
    assert.match(result.invalid[0], /corrupt\.webp: could not be decoded as a valid WEBP image\./);
    assert.match(result.invalid[1], /mismatch\.png: file extension expects png, but decoded format is jpeg\./);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
