/* Photo library helpers. Hashes, capture dates, and album membership stay
   in encrypted metadata. Location is never copied out of the original. */

const MEDIA_NAME = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|tiff?|mp4|mov|m4v|webm|mkv)$/i;
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

function processBlock(h, block) {
  const w = new Uint32Array(64);
  for (let i = 0; i < 16; i++) {
    const at = i * 4;
    w[i] = ((block[at] << 24) | (block[at + 1] << 16) | (block[at + 2] << 8) | block[at + 3]) >>> 0;
  }
  for (let i = 16; i < 64; i++) {
    const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
    const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
  }
  let a = h[0];
  let b = h[1];
  let c = h[2];
  let d = h[3];
  let e = h[4];
  let f = h[5];
  let g = h[6];
  let hh = h[7];
  for (let i = 0; i < 64; i++) {
    const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const ch = (e & f) ^ (~e & g);
    const t1 = (hh + s1 + ch + K[i] + w[i]) >>> 0;
    const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (s0 + maj) >>> 0;
    hh = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) >>> 0;
  }
  h[0] = (h[0] + a) >>> 0;
  h[1] = (h[1] + b) >>> 0;
  h[2] = (h[2] + c) >>> 0;
  h[3] = (h[3] + d) >>> 0;
  h[4] = (h[4] + e) >>> 0;
  h[5] = (h[5] + f) >>> 0;
  h[6] = (h[6] + g) >>> 0;
  h[7] = (h[7] + hh) >>> 0;
}

export function createSha256() {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);
  let buf = new Uint8Array(0);
  let length = 0;
  let done = false;
  return {
    update(chunk) {
      const raw = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk || []);
      if (!raw.length || done) return;
      const next = new Uint8Array(buf.length + raw.length);
      next.set(buf, 0);
      next.set(raw, buf.length);
      let off = 0;
      while (next.length - off >= 64) {
        processBlock(h, next.subarray(off, off + 64));
        off += 64;
      }
      buf = next.slice(off);
      length += raw.length;
    },
    hex() {
      if (done) return "";
      done = true;
      const bitsHi = Math.floor(length / 0x20000000);
      const bitsLo = (length % 0x20000000) * 8;
      const withBit = buf.length + 1;
      const zeros = (56 - (withBit % 64) + 64) % 64;
      const padded = new Uint8Array(withBit + zeros + 8);
      padded.set(buf);
      padded[buf.length] = 0x80;
      padded[padded.length - 8] = (bitsHi >>> 24) & 255;
      padded[padded.length - 7] = (bitsHi >>> 16) & 255;
      padded[padded.length - 6] = (bitsHi >>> 8) & 255;
      padded[padded.length - 5] = bitsHi & 255;
      padded[padded.length - 4] = (bitsLo >>> 24) & 255;
      padded[padded.length - 3] = (bitsLo >>> 16) & 255;
      padded[padded.length - 2] = (bitsLo >>> 8) & 255;
      padded[padded.length - 1] = bitsLo & 255;
      for (let i = 0; i < padded.length; i += 64) processBlock(h, padded.subarray(i, i + 64));
      let hex = "";
      for (let i = 0; i < 8; i++) hex += h[i].toString(16).padStart(8, "0");
      return hex;
    }
  };
}

export function sha256Hex(bytes) {
  const hasher = createSha256();
  hasher.update(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []));
  return hasher.hex();
}

export function isMediaFile(file) {
  const type = String((file && file.type) || "");
  if (type.indexOf("image/") === 0 || type.indexOf("video/") === 0) return true;
  return MEDIA_NAME.test(String((file && file.name) || ""));
}

export function duplicateHash(items, hash) {
  const needle = String(hash || "");
  if (!needle) return null;
  const rows = items || [];
  for (let i = 0; i < rows.length; i++) {
    const item = rows[i];
    if (!item || item.deletedAt || !item.meta || !item.meta.photo) continue;
    if (item.meta.hash === needle) return item;
  }
  return null;
}

export function groupPhotos(rows, timeOf) {
  const groups = [];
  const by = Object.create(null);
  (rows || []).forEach((row) => {
    const ms = Number(timeOf(row)) || 0;
    const date = new Date(ms);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const key = year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
    let group = by[key];
    if (!group) {
      group = { key: key, year: year, month: month, day: day, time: ms, rows: [] };
      by[key] = group;
      groups.push(group);
    }
    group.rows.push(row);
  });
  return groups;
}

export function scrubFromGroups(groups) {
  const marks = [];
  const seen = Object.create(null);
  (groups || []).forEach((group) => {
    const yearKey = "y" + group.year;
    if (!seen[yearKey]) {
      seen[yearKey] = true;
      marks.push({ kind: "year", year: group.year, month: group.month, key: group.key });
    }
    const monthKey = "m" + group.year + "-" + group.month;
    if (!seen[monthKey]) {
      seen[monthKey] = true;
      marks.push({ kind: "month", year: group.year, month: group.month, key: group.key });
    }
  });
  return marks;
}

function u16(buf, off, le) {
  if (off < 0 || off + 2 > buf.length) return 0;
  return le ? (buf[off] | (buf[off + 1] << 8)) : ((buf[off] << 8) | buf[off + 1]);
}

function u32(buf, off, le) {
  if (off < 0 || off + 4 > buf.length) return 0;
  return le
    ? (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0
    : ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}

function ascii(buf, off, count) {
  let out = "";
  const end = Math.min(buf.length, off + count);
  for (let i = off; i < end; i++) {
    if (!buf[i]) break;
    out += String.fromCharCode(buf[i]);
  }
  return out;
}

function typeSize(type) {
  if (type === 1 || type === 2 || type === 6 || type === 7) return 1;
  if (type === 3 || type === 8) return 2;
  if (type === 4 || type === 9 || type === 11) return 4;
  if (type === 5 || type === 10 || type === 12) return 8;
  return 0;
}

function exifDate(text) {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(text || ""));
  if (!match) return 0;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > 31) return 0;
  return new Date(year, month - 1, day, Number(match[4]), Number(match[5]), Number(match[6])).getTime();
}

function walkIfd(buf, tiff, ifdOff, le, depth, dates) {
  if (depth > 4 || ifdOff < 8) return;
  const start = tiff + ifdOff;
  if (start + 2 > buf.length) return;
  const count = u16(buf, start, le);
  if (!count || count > 80 || start + 2 + count * 12 > buf.length) return;
  for (let n = 0; n < count; n++) {
    const ent = start + 2 + n * 12;
    const tag = u16(buf, ent, le);
    const type = u16(buf, ent + 2, le);
    const nval = u32(buf, ent + 4, le);
    const size = typeSize(type) * nval;
    if (!size || size > buf.length) continue;
    const valueOff = size <= 4 ? ent + 8 : tiff + u32(buf, ent + 8, le);
    if ((tag === 0x0132 || tag === 0x9003 || tag === 0x9004) && type === 2) dates.push({ tag: tag, text: ascii(buf, valueOff, Math.min(nval, 64)) });
    else if (tag === 0x8769) walkIfd(buf, tiff, u32(buf, ent + 8, le), le, depth + 1, dates);
  }
}

function datesFromTiff(buf, tiff) {
  if (tiff + 8 > buf.length) return 0;
  const order = u16(buf, tiff, true);
  const le = order === 0x4949;
  if (!le && order !== 0x4d4d) return 0;
  if (u16(buf, tiff + 2, le) !== 42) return 0;
  const dates = [];
  walkIfd(buf, tiff, u32(buf, tiff + 4, le), le, 0, dates);
  const rank = { 36867: 0, 36868: 1, 306: 2 };
  dates.sort((a, b) => (rank[a.tag] == null ? 9 : rank[a.tag]) - (rank[b.tag] == null ? 9 : rank[b.tag]));
  for (let i = 0; i < dates.length; i++) {
    const when = exifDate(dates[i].text);
    if (when) return when;
  }
  return 0;
}

function readJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const out = { captured: 0, width: 0, height: 0 };
  let i = 2;
  while (i + 4 < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
    const length = (buf[i + 2] << 8) | buf[i + 3];
    if (length < 2 || i + 2 + length > buf.length) break;
    if (marker === 0xe1 && length > 8 && ascii(buf, i + 4, 4) === "Exif") out.captured = out.captured || datesFromTiff(buf, i + 10);
    if (marker >= 0xc0 && marker <= 0xc3) {
      out.height = out.height || ((buf[i + 5] << 8) | buf[i + 6]);
      out.width = out.width || ((buf[i + 7] << 8) | buf[i + 8]);
    }
    if (marker === 0xda) break;
    i += 2 + length;
  }
  return out;
}

function readPng(buf) {
  if (buf.length < 24 || ascii(buf, 1, 3) !== "PNG") return null;
  const out = { captured: 0, width: 0, height: 0 };
  let i = 8;
  while (i + 12 <= buf.length) {
    const length = u32(buf, i, false);
    const kind = ascii(buf, i + 4, 4);
    if (i + 12 + length > buf.length) break;
    if (kind === "IHDR" && length >= 8) {
      out.width = u32(buf, i + 8, false);
      out.height = u32(buf, i + 12, false);
    } else if (kind === "tIME" && length >= 7) {
      const year = u16(buf, i + 8, false);
      out.captured = out.captured || new Date(year, buf[i + 10] - 1, buf[i + 11], buf[i + 12], buf[i + 13], buf[i + 14]).getTime();
    } else if (kind === "eXIf") out.captured = out.captured || datesFromTiff(buf, i + 8);
    i += 12 + length;
  }
  return out;
}

function qtTime(seconds) {
  if (!seconds || seconds < 1e9) return 0;
  const ms = Date.UTC(1904, 0, 1) + seconds * 1000;
  if (ms < Date.UTC(1980, 0, 1) || ms > Date.UTC(2100, 0, 1)) return 0;
  return ms;
}

function u64(buf, off) {
  if (off < 0 || off + 8 > buf.length) return 0;
  return u32(buf, off, false) * 0x100000000 + u32(buf, off + 4, false);
}

function scanMvhd(buf) {
  for (let i = 4; i + 16 < buf.length; i++) {
    if (buf[i] !== 0x6d || buf[i + 1] !== 0x76 || buf[i + 2] !== 0x68 || buf[i + 3] !== 0x64) continue;
    const version = buf[i + 4];
    const seconds = version === 1 ? u64(buf, i + 8) : u32(buf, i + 8, false);
    const when = qtTime(seconds);
    if (when) return when;
  }
  return 0;
}

function scanTkhd(buf) {
  for (let i = 4; i + 84 < buf.length; i++) {
    if (buf[i] !== 0x74 || buf[i + 1] !== 0x6b || buf[i + 2] !== 0x68 || buf[i + 3] !== 0x64) continue;
    const version = buf[i + 4];
    const widthAt = i + 4 + (version === 1 ? 88 : 76);
    if (widthAt + 8 > buf.length) continue;
    const width = u32(buf, widthAt, false) / 65536;
    const height = u32(buf, widthAt + 4, false) / 65536;
    if (width > 0 && height > 0 && width < 20000 && height < 20000) return { width: Math.round(width), height: Math.round(height) };
  }
  return { width: 0, height: 0 };
}

function readMp4(buf) {
  if (!buf || buf.length < 16) return null;
  const captured = scanMvhd(buf);
  const box = scanTkhd(buf);
  if (!captured && !box.width) return null;
  return { captured: captured, width: box.width, height: box.height };
}

function readHeader(buf) {
  if (!buf || !buf.length) return { captured: 0, width: 0, height: 0 };
  return readJpeg(buf) || readPng(buf) || readMp4(buf) || { captured: 0, width: 0, height: 0 };
}

export function captureFromParts(head, tail) {
  const first = readHeader(head instanceof Uint8Array ? head : new Uint8Array(head || []));
  const second = readHeader(tail instanceof Uint8Array ? tail : new Uint8Array(tail || []));
  return {
    captured: first.captured || second.captured || 0,
    width: first.width || second.width || 0,
    height: first.height || second.height || 0
  };
}
