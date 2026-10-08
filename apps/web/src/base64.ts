// Pure base64 for PCM bytes. No globals, so tests and the worklet can share it.

const TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const REVERSE: Int16Array = new Int16Array(128).fill(-1);
for (let i = 0; i < TABLE.length; i++) REVERSE[TABLE.charCodeAt(i)] = i;

export function encodeBase64(bytes: Uint8Array): string {
  const out: string[] = [];
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out.push(TABLE[(n >> 18) & 63], TABLE[(n >> 12) & 63], TABLE[(n >> 6) & 63], TABLE[n & 63]);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out.push(TABLE[(n >> 18) & 63], TABLE[(n >> 12) & 63], "=", "=");
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out.push(TABLE[(n >> 18) & 63], TABLE[(n >> 12) & 63], TABLE[(n >> 6) & 63], "=");
  }
  return out.join("");
}

export function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const full = Math.floor(clean.length / 4) * 4;
  const tail = clean.length - full;
  const outLen = (full / 4) * 3 + (tail === 2 ? 1 : tail === 3 ? 2 : 0);
  const out = new Uint8Array(outLen);
  let o = 0;
  let i = 0;
  for (; i < full; i += 4) {
    const n =
      (REVERSE[clean.charCodeAt(i)] << 18) |
      (REVERSE[clean.charCodeAt(i + 1)] << 12) |
      (REVERSE[clean.charCodeAt(i + 2)] << 6) |
      REVERSE[clean.charCodeAt(i + 3)];
    out[o++] = (n >> 16) & 255;
    out[o++] = (n >> 8) & 255;
    out[o++] = n & 255;
  }
  if (tail === 2) {
    const n = (REVERSE[clean.charCodeAt(i)] << 18) | (REVERSE[clean.charCodeAt(i + 1)] << 12);
    out[o++] = (n >> 16) & 255;
  } else if (tail === 3) {
    const n =
      (REVERSE[clean.charCodeAt(i)] << 18) |
      (REVERSE[clean.charCodeAt(i + 1)] << 12) |
      (REVERSE[clean.charCodeAt(i + 2)] << 6);
    out[o++] = (n >> 16) & 255;
    out[o++] = (n >> 8) & 255;
  }
  return out;
}
