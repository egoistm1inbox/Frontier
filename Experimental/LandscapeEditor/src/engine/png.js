// Minimal PNG writer for heightmap and satmap export. The compressor is passed in, so the same
// code runs in the browser (CompressionStream) and in Node (zlib).

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function encode(width, height, bitDepth, colorType, scanlines, deflate) {
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header[8] = bitDepth;
  header[9] = colorType;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  const compressed = await deflate(scanlines);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

// 16-bit grayscale. Heights are normalised, so 0 is the lowest point and 65535 is the maximum.
export async function encodeHeightPng16(heights, size, deflate) {
  const rowBytes = 1 + size * 2;
  const scanlines = new Uint8Array(rowBytes * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * rowBytes;
    scanlines[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const value = Math.round(Math.min(1, Math.max(0, heights[y * size + x])) * 65535);
      scanlines[row + 1 + x * 2] = value >> 8;
      scanlines[row + 2 + x * 2] = value & 255;
    }
  }
  return encode(size, size, 16, 0, scanlines, deflate);
}

// 8-bit RGBA, rows top to bottom.
export async function encodeRgbaPng(rgba, width, height, deflate) {
  const rowBytes = 1 + width * 4;
  const scanlines = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    scanlines[y * rowBytes] = 0;
    scanlines.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * rowBytes + 1);
  }
  return encode(width, height, 8, 6, scanlines, deflate);
}
