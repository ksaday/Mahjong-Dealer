// A browser-side UUIDv7 generator for `cmdId` (docs/13_Input_Integrity.md
// §4.3): a 48-bit millisecond timestamp, a 4-bit version, a 2-bit variant,
// and 74 bits of randomness. `@mahjong-dealer/db` has its own `uuidv7()`
// for primary keys, but `web` may not import `db` (docs/03 §4.1, C-06) —
// same RFC 9562 layout, independently implemented for a different runtime
// (Web Crypto instead of `node:crypto`).
export function uuidv7(): string {
  const unixTsMs = BigInt(Date.now());
  const rand = new Uint8Array(10);
  crypto.getRandomValues(rand);
  const bytes = new Uint8Array(16);

  bytes[0] = Number((unixTsMs >> 40n) & 0xffn);
  bytes[1] = Number((unixTsMs >> 32n) & 0xffn);
  bytes[2] = Number((unixTsMs >> 24n) & 0xffn);
  bytes[3] = Number((unixTsMs >> 16n) & 0xffn);
  bytes[4] = Number((unixTsMs >> 8n) & 0xffn);
  bytes[5] = Number(unixTsMs & 0xffn);
  bytes[6] = 0x70 | (rand[0]! & 0x0f); // version 7
  bytes[7] = rand[1]!;
  bytes[8] = 0x80 | (rand[2]! & 0x3f); // variant 10
  bytes.set(rand.subarray(3, 10), 9);

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
