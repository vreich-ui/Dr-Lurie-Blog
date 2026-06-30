import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

const setupValidationFixture = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'upload-image-validation-'));
  const uploadRoot = path.join(root, 'src/assets/images/uploads');
  const postRoot = path.join(root, 'src/data/post');

  await mkdir(uploadRoot, { recursive: true });
  await mkdir(postRoot, { recursive: true });

  return { root, uploadRoot, postRoot };
};

test('validate-upload-images reports corrupt and extension-mismatched uploads', async () => {
  const { root, uploadRoot, postRoot } = await setupValidationFixture();

  try {
    await writeFile(path.join(uploadRoot, 'valid.png'), await createImageBytes('png'));
    await writeFile(path.join(uploadRoot, 'corrupt.webp'), Buffer.from('not an image'));
    await writeFile(path.join(uploadRoot, 'mismatch.png'), await createImageBytes('jpeg'));
    await writeFile(path.join(uploadRoot, 'ignored.gif'), Buffer.from('not checked'));

    const result = await validateUploadImages(uploadRoot, postRoot);

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

test('validate-upload-images passes when markdown references an existing upload image', async () => {
  const { root, uploadRoot, postRoot } = await setupValidationFixture();

  try {
    await mkdir(path.join(uploadRoot, 'article'), { recursive: true });
    await writeFile(path.join(uploadRoot, 'article/hero.webp'), await createImageBytes('webp'));
    await writeFile(
      path.join(postRoot, 'article.md'),
      `---\ntitle: Existing image\nimage: ~/assets/images/uploads/article/hero.webp\n---\n\nBody.\n`
    );

    const result = await validateUploadImages(uploadRoot, postRoot);

    assert.equal(result.invalid.length, 0);
    assert.equal(result.references.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validate-upload-images fails when frontmatter image references a missing upload image', async () => {
  const { root, uploadRoot, postRoot } = await setupValidationFixture();

  try {
    const markdownFile = path.join(postRoot, 'missing-frontmatter.md');
    await writeFile(
      markdownFile,
      `---\ntitle: Missing frontmatter image\nimage: ~/assets/images/uploads/article/missing.webp\n---\n\nBody.\n`
    );

    const result = await validateUploadImages(uploadRoot, postRoot);

    assert.equal(result.invalid.length, 1);
    assert.match(result.invalid[0], /missing-frontmatter\.md: missing frontmatter image/);
    assert.match(result.invalid[0], /~\/assets\/images\/uploads\/article\/missing\.webp/);
    assert.match(result.invalid[0], /src\/assets\/images\/uploads\/article\/missing\.webp/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validate-upload-images fails when inline markdown references a missing upload image', async () => {
  const { root, uploadRoot, postRoot } = await setupValidationFixture();

  try {
    const markdownFile = path.join(postRoot, 'missing-inline.md');
    await writeFile(
      markdownFile,
      `---\ntitle: Missing inline image\n---\n\n![Alt text](~/assets/images/uploads/article/inline-missing.webp)\n`
    );

    const result = await validateUploadImages(uploadRoot, postRoot);

    assert.equal(result.invalid.length, 1);
    assert.match(result.invalid[0], /missing-inline\.md: missing inline image/);
    assert.match(result.invalid[0], /~\/assets\/images\/uploads\/article\/inline-missing\.webp/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validate-upload-images passes when markdown has no image references', async () => {
  const { root, uploadRoot, postRoot } = await setupValidationFixture();

  try {
    await writeFile(
      path.join(postRoot, 'no-images.md'),
      `---\ntitle: No images\n---\n\nThis post intentionally has no images.\n`
    );

    const result = await validateUploadImages(uploadRoot, postRoot);

    assert.equal(result.invalid.length, 0);
    assert.equal(result.references.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
