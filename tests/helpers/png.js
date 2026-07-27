// Ein echtes PNG erzeugen, ohne Fremdbibliothek — die Bild-Tests brauchen
// Daten, aus denen der Server auch wirklich ein Vorschaubild rechnen kann
// (sharp lehnt Fantasie-Bytes ab).
const zlib = require("zlib");

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

// Farbverlauf, damit man auf einem Screenshot auch sieht, dass es das Bild ist
function makePng(w = 120, h = 80) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0; // Filter-Byte je Zeile
    for (let x = 0; x < w; x++) {
      raw[o++] = Math.round((x / w) * 255);
      raw[o++] = Math.round((y / h) * 255);
      raw[o++] = 160;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // 8 Bit je Kanal
  ihdr[9] = 2;  // Truecolor
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

module.exports = { makePng };
