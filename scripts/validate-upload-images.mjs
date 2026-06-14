#!/usr/bin/env node
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import sharp from 'sharp';

const defaultUploadRoot = 'src/assets/images/uploads';
const extensionFormat = new Map([
  ['.jpg', 'jpeg'],
  ['.jpeg', 'jpeg'],
  ['.png', 'png'],
  ['.webp', 'webp'],
]);

const toPosixPath = (value) => value.split(path.sep).join('/');

const getExpectedFormat = (filePath) => extensionFormat.get(path.extname(filePath).toLowerCase());

export const collectUploadImageFiles = async (root = defaultUploadRoot) => {
  const files = [];

  const visit = async (directory) => {
    let entries;

    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && getExpectedFormat(entryPath)) {
        files.push(entryPath);
      }
    }
  };

  await visit(root);

  return files.sort((left, right) => left.localeCompare(right));
};

export const validateUploadImageFile = async (filePath) => {
  const expectedFormat = getExpectedFormat(filePath);

  if (!expectedFormat) return undefined;

  let metadata;

  try {
    metadata = await sharp(filePath, { failOn: 'error' }).metadata();
  } catch {
    return `${toPosixPath(filePath)}: could not be decoded as a valid ${expectedFormat.toUpperCase()} image.`;
  }

  if (!metadata.width || metadata.width <= 0 || !metadata.height || metadata.height <= 0) {
    return `${toPosixPath(filePath)}: decoded image is missing positive width/height metadata.`;
  }

  if (metadata.format !== expectedFormat) {
    return `${toPosixPath(filePath)}: file extension expects ${expectedFormat}, but decoded format is ${metadata.format ?? 'unknown'}.`;
  }

  return undefined;
};

export const validateUploadImages = async (root = defaultUploadRoot) => {
  const files = await collectUploadImageFiles(root);
  const invalid = [];

  for (const file of files) {
    const issue = await validateUploadImageFile(file);
    if (issue) invalid.push(issue);
  }

  return { files, invalid };
};

const main = async () => {
  const root = process.argv[2] || defaultUploadRoot;
  const { files, invalid } = await validateUploadImages(root);

  if (invalid.length) {
    for (const issue of invalid) console.error(issue);
    console.error(`Upload image validation failed: ${invalid.length} invalid image${invalid.length === 1 ? '' : 's'}.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Upload image validation passed: ${files.length} image${files.length === 1 ? '' : 's'} checked.`);
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
