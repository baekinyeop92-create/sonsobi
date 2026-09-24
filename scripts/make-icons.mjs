/* PWA 아이콘 PNG 생성 — 외부 의존성 없이 Node 내장 zlib만 사용.
   web/icons/{icon-180,icon-192,icon-512,maskable-512}.png
   디자인: 브랜드색 배경 + 흰 캘린더 카드 + 소비 농도(heat) 3×3 그리드 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../web/icons');
mkdirSync(OUT, { recursive: true });

/* ---------- PNG 인코더 ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8bit RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // 필터 없음
    rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- 그리기 ---------- */
const hex = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const BG = hex('#2a78d6'), WHITE = [255, 255, 255];
const GRID = [
  ['#d6e7fb', '#b1d0f6', '#d6e7fb'],
  ['#b1d0f6', '#2a78d6', '#86b6ef'],
  ['#d6e7fb', '#86b6ef', '#b1d0f6']
].map(row => row.map(hex));

// 둥근 사각형 포함 판정 (r만큼 안쪽 코어 사각형까지의 거리 ≤ r)
function rr(u, v, x0, y0, x1, y1, r) {
  const qx = Math.max(x0 + r - u, u - (x1 - r), 0);
  const qy = Math.max(y0 + r - v, v - (y1 - r), 0);
  return qx * qx + qy * qy <= r * r;
}

function paint(u, v) {
  let c = BG;
  if (rr(u, v, 0.17, 0.21, 0.83, 0.87, 0.07)) c = WHITE;
  const s = 0.148, gap = 0.0335, x0 = 0.245, y0 = 0.305, rad = 0.03;
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    const gx = x0 + col * (s + gap), gy = y0 + row * (s + gap);
    if (rr(u, v, gx, gy, gx + s, gy + s, rad)) c = GRID[row][col];
  }
  return c;
}

function render(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const scale = maskable ? 0.72 : 1; // maskable은 안전 영역 안으로 축소
  const SS = 2; // 2×2 슈퍼샘플링
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      let u = (x + (sx + 0.5) / SS) / size, v = (y + (sy + 0.5) / SS) / size;
      u = (u - 0.5) / scale + 0.5; v = (v - 0.5) / scale + 0.5;
      const c = (u < 0 || u > 1 || v < 0 || v > 1) ? BG : paint(u, v);
      r += c[0]; g += c[1]; b += c[2];
    }
    const i = (y * size + x) * 4, n = SS * SS;
    buf[i] = Math.round(r / n); buf[i + 1] = Math.round(g / n); buf[i + 2] = Math.round(b / n); buf[i + 3] = 255;
  }
  return encodePNG(size, size, buf);
}

for (const [name, size, opt] of [
  ['icon-180.png', 180, {}],
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['maskable-512.png', 512, { maskable: true }]
]) {
  const png = render(size, opt);
  writeFileSync(join(OUT, name), png);
  console.log(`✓ web/icons/${name} (${png.length.toLocaleString()} bytes)`);
}
