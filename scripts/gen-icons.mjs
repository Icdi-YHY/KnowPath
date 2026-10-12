// 离线生成 PWA 图标（无第三方依赖）：深色圆角底 + 主线/支线节点图形
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../public');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// 简易 SDF
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy || 1), 0, 1);
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return Math.hypot(dx, dy);
}
function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

const BG0 = [10, 15, 32];
const BG1 = [27, 39, 64];
const BLUE = [91, 140, 255];
const TEAL = [34, 211, 166];

function render(size) {
  const ss = 3; // 超采样
  const S = size * ss;
  const acc = new Float64Array(size * size * 4);

  // 几何（以 S 为基准）
  const cx = S / 2;
  const cy = S / 2;
  const P = (fx, fy) => [fx * S, fy * S];
  const mainPts = [P(0.17, 0.38), P(0.5, 0.32), P(0.83, 0.4)];
  const branchPts = [mainPts[1], P(0.29, 0.72)];

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      // 背景圆角矩形
      const d = sdRoundRect(px, py, cx, cy, S * 0.5 - S * 0.03, S * 0.5 - S * 0.03, S * 0.2);
      const inside = 1 - smooth(-1.2 * ss, 1.2 * ss, d);
      if (inside <= 0) continue;

      const t = clamp((px / S) * 0.5 + (py / S) * 0.5, 0, 1);
      let col = mix(BG0, BG1, t);

      // 主线
      let lineMask = 0;
      for (let i = 0; i < mainPts.length - 1; i++) {
        const seg = sdSegment(px, py, mainPts[i][0], mainPts[i][1], mainPts[i + 1][0], mainPts[i + 1][1]);
        lineMask = Math.max(lineMask, 1 - smooth(S * 0.018, S * 0.028, seg));
      }
      // 支线
      const bseg = sdSegment(px, py, branchPts[0][0], branchPts[0][1], branchPts[1][0], branchPts[1][1]);
      lineMask = Math.max(lineMask, (1 - smooth(S * 0.014, S * 0.022, bseg)) * 0.85);

      if (lineMask > 0) {
        const lt = clamp(px / S, 0, 1);
        col = mix(col, mix(BLUE, TEAL, lt), lineMask);
      }

      // 节点圆点
      const dots = [
        [mainPts[0][0], mainPts[0][1], S * 0.045, BLUE],
        [mainPts[1][0], mainPts[1][1], S * 0.05, [122, 162, 255]],
        [mainPts[2][0], mainPts[2][1], S * 0.045, TEAL],
        [branchPts[1][0], branchPts[1][1], S * 0.04, TEAL],
      ];
      for (const [dx, dy, dr, dcol] of dots) {
        const dd = sdCircle(px, py, dx, dy, dr);
        const m = 1 - smooth(-1.5 * ss, 1.5 * ss, dd);
        if (m > 0) col = mix(col, dcol, m);
      }

      for (let i = 0; i < 4; i++) acc[(y * size + x) * 4 + i] += col[i] * inside;
    }
  }

  // 降采样
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const n = ss * ss;
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(clamp(acc[i * 4 + c] / n, 0, 255));
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** 组装 Windows .ico（Vista+ 支持内嵌 PNG 条目） */
function encodeIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const blobs = [];
  entries.forEach((e, i) => {
    const b = 16 * i;
    const dim = e.size >= 256 ? 0 : e.size;
    dir[b] = dim;
    dir[b + 1] = dim;
    dir[b + 2] = 0;
    dir[b + 3] = 0;
    dir.writeUInt16LE(1, b + 4); // planes
    dir.writeUInt16LE(32, b + 6); // bit depth
    dir.writeUInt32LE(e.png.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += e.png.length;
    blobs.push(e.png);
  });
  return Buffer.concat([header, dir, ...blobs]);
}

mkdirSync(OUT, { recursive: true });
for (const size of [192, 512]) {
  const png = encodePng(size, size, render(size));
  writeFileSync(resolve(OUT, `pwa-${size}.png`), png);
  console.log(`generated pwa-${size}.png (${png.length} bytes)`);
}

// Windows 应用图标
const BUILD_DIR = resolve(__dirname, '../build');
mkdirSync(BUILD_DIR, { recursive: true });
const icoSizes = [16, 32, 48, 64, 128, 256];
const ico = encodeIco(icoSizes.map((size) => ({ size, png: encodePng(size, size, render(size)) })));
writeFileSync(resolve(BUILD_DIR, 'icon.ico'), ico);
console.log(`generated build/icon.ico (${ico.length} bytes, ${icoSizes.join('/')})`);
