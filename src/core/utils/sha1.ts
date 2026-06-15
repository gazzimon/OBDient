// Minimal pure-JS SHA-1 — used only to generate Vincario API checksums.
// Not used for any security-sensitive purpose.

function rotl(n: number, s: number): number {
  return ((n << s) | (n >>> (32 - s))) >>> 0;
}

function toHex(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0');
}

export function sha1(str: string): string {
  // Encode as UTF-8 bytes
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }

  const len = bytes.length;

  // Build 32-bit word array with padding
  const words: number[] = [];
  for (let i = 0; i < len; i++) {
    words[i >> 2] = (words[i >> 2] ?? 0) | ((bytes[i]!) << (24 - (i % 4) * 8));
  }
  words[len >> 2] = (words[len >> 2] ?? 0) | (0x80 << (24 - (len % 4) * 8));
  const padLen = ((len + 8 >> 6) + 1) * 16;
  while (words.length < padLen) words.push(0);
  words[padLen - 1] = len * 8;

  // Initial hash values
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  // Process each 512-bit (16-word) block
  for (let i = 0; i < padLen; i += 16) {
    const w: number[] = words.slice(i, i + 16);
    while (w.length < 80) {
      const x = w[w.length - 16]! ^ w[w.length - 14]! ^ w[w.length - 8]! ^ w[w.length - 3]!;
      w.push(rotl(x, 1));
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4;

    for (let j = 0; j < 80; j++) {
      let f: number, k: number;
      if      (j < 20) { f = (b & c) | (~b & d);          k = 0x5a827999; }
      else if (j < 40) { f = b ^ c ^ d;                   k = 0x6ed9eba1; }
      else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else             { f = b ^ c ^ d;                   k = 0xca62c1d6; }

      const temp = (rotl(a, 5) + f + e + k + w[j]!) >>> 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4);
}
