// Generates Oopsie's PNG icons with no image dependencies.
// The mascot ("Oops") is drawn with signed-distance shapes and supersampled
// for smooth edges, then encoded as PNG with node:zlib.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'public/icons');
mkdirSync(outDir, { recursive: true });

const YELLOW = [255, 201, 60];
const YELLOW_SHADE = [242, 168, 17];
const INK = [43, 33, 24];
const BLUSH = [255, 150, 110];
const DROP = [86, 170, 235];

// Signed distance helpers in a 0..1 unit square (negative = inside).
const roundedBox = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const ellipse = (x, y, cx, cy, rx, ry) => (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry);
const ring = (x, y, cx, cy, r, w) => Math.abs(Math.hypot(x - cx, y - cy) - r) - w / 2;
// Teardrop: circle plus a point above it.
const drop = (x, y, cx, cy, r) => {
  const c = Math.hypot(x - cx, y - cy) - r;
  const tipY = cy - r * 2.1;
  if (y > cy || y < tipY) return c;
  const t = (y - tipY) / (cy - tipY);
  const half = r * Math.sqrt(t) * 0.98;
  const tri = Math.abs(x - cx) - half;
  return Math.min(c, tri);
};

function shade(x, y, size) {
  const detailed = size >= 32;
  // Layers are painted bottom to top: [distance, color].
  const layers = [
    [roundedBox(x, y, 0.5, 0.53, 0.44, 0.43, 0.2), YELLOW_SHADE],
    [roundedBox(x, y, 0.5, 0.5, 0.44, 0.43, 0.2), YELLOW],
  ];
  if (detailed) {
    layers.push([ellipse(x, y, 0.27, 0.6, 0.07, 0.045), BLUSH]);
    layers.push([ellipse(x, y, 0.73, 0.6, 0.07, 0.045), BLUSH]);
  }
  const eyeRy = detailed ? 0.075 : 0.09;
  layers.push([ellipse(x, y, 0.35, 0.43, 0.055, eyeRy), INK]);
  layers.push([ellipse(x, y, 0.65, 0.43, 0.055, eyeRy), INK]);
  // The surprised "oops" mouth.
  layers.push([ring(x, y, 0.5, 0.67, detailed ? 0.065 : 0.08, detailed ? 0.045 : 0.07), INK]);
  if (detailed) layers.push([drop(x, y, 0.84, 0.25, 0.06), DROP]);
  return layers;
}

function render(size) {
  const ss = 5;
  const px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (pxi + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;
          let col = null;
          for (const [d, c] of shade(x, y, size)) if (d <= 0) col = c;
          if (col) { r += col[0]; g += col[1]; b += col[2]; a += 1; }
        }
      }
      const i = (py * size + pxi) * 4;
      const n = ss * ss;
      if (a > 0) {
        px[i] = Math.round(r / a); px[i + 1] = Math.round(g / a); px[i + 2] = Math.round(b / a);
      }
      px[i + 3] = Math.round((a / n) * 255);
    }
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(resolve(outDir, `icon-${size}.png`), encodePng(size, render(size)));
  console.log(`icons/icon-${size}.png`);
}
