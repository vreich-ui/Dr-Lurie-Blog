import { copyFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const width = 1200;
const height = 630;
const output = new URL('../public/social-preview.png', import.meta.url);
const jpgOutput = new URL('../public/social-preview.jpg', import.meta.url);
const jpgSource = new URL('../public/dr-lurie-portrait.jpg', import.meta.url);

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));

  return Buffer.concat([length, typeBuffer, data, crc]);
};

const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));
const mix = (a, b, amount) => a * (1 - amount) + b * amount;

const setPixel = (row, x, r, g, b) => {
  const offset = 1 + x * 3;
  row[offset] = clamp(r);
  row[offset + 1] = clamp(g);
  row[offset + 2] = clamp(b);
};

const inRoundedRect = (x, y, left, top, rectWidth, rectHeight, radius) => {
  const right = left + rectWidth;
  const bottom = top + rectHeight;
  if (x < left || x > right || y < top || y > bottom) return false;

  const cornerX = x < left + radius ? left + radius : x > right - radius ? right - radius : x;
  const cornerY = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y;
  return (x - cornerX) ** 2 + (y - cornerY) ** 2 <= radius ** 2;
};

const rows = [];

for (let y = 0; y < height; y += 1) {
  const row = Buffer.alloc(1 + width * 3);
  row[0] = 0;

  for (let x = 0; x < width; x += 1) {
    const horizontal = x / (width - 1);
    const vertical = y / (height - 1);

    let r = mix(251, 219, horizontal) - 8 * vertical;
    let g = mix(247, 238, horizontal) - 4 * vertical;
    let b = mix(239, 243, horizontal) + 8 * vertical;

    if (x < 18) {
      r = 15;
      g = 118;
      b = 110;
    }

    const circles = [
      [910, 190, 86, 73, 154, 148, 4],
      [1015, 315, 132, 32, 113, 109, 5],
      [820, 390, 58, 180, 215, 210, 0],
    ];

    for (const [cx, cy, radius, cr, cg, cb, stroke] of circles) {
      const distance = Math.hypot(x - cx, y - cy);
      if (stroke && Math.abs(distance - radius) <= stroke) {
        r = mix(r, cr, 0.82);
        g = mix(g, cg, 0.82);
        b = mix(b, cb, 0.82);
      } else if (!stroke && distance <= radius) {
        r = mix(r, cr, 0.18);
        g = mix(g, cg, 0.18);
        b = mix(b, cb, 0.18);
      }
    }

    if (inRoundedRect(x, y, 76, 116, 646, 398, 34)) {
      r = mix(r, 255, 0.74);
      g = mix(g, 255, 0.74);
      b = mix(b, 255, 0.74);
    }

    const darkBars = [
      [106, 220, 280, 42],
      [106, 294, 470, 42],
      [106, 368, 345, 42],
    ];
    const mutedBars = [
      [106, 454, 520, 18],
      [106, 486, 420, 18],
    ];
    const accentBars = [
      [106, 162, 190, 18],
      [106, 532, 230, 34],
    ];

    for (const [left, top, rectWidth, rectHeight] of darkBars) {
      if (inRoundedRect(x, y, left, top, rectWidth, rectHeight, 6)) {
        r = 31;
        g = 41;
        b = 55;
      }
    }

    for (const [left, top, rectWidth, rectHeight] of mutedBars) {
      if (inRoundedRect(x, y, left, top, rectWidth, rectHeight, 4)) {
        r = 88;
        g = 101;
        b = 117;
      }
    }

    for (const [left, top, rectWidth, rectHeight] of accentBars) {
      if (inRoundedRect(x, y, left, top, rectWidth, rectHeight, 6)) {
        r = 15;
        g = 118;
        b = 110;
      }
    }

    setPixel(row, x, r, g, b);
  }

  rows.push(row);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8;
ihdr[9] = 2;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

writeFileSync(output, png);
copyFileSync(jpgSource, jpgOutput);
console.log(`Generated ${output.pathname} (${width}x${height})`);
console.log(`Generated ${jpgOutput.pathname} from existing JPG fallback asset`);
