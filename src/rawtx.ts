import type { TxRow } from "./types.ts";

/// A signed raw transaction, decoded in the browser so the user sees what it pays before broadcasting it.
/// Amounts are atomic units (1 PRL = 10^8). A raw transaction does not carry its inputs' amounts, so
/// the fee is not known until the network has it.
export type RawTx = {
  hex: string;
  txid: string;
  size: number;
  vsize: number;
  inputCount: number;
  outputs: TxRow[];
  value: string;
};

// Policy caps a standard transaction at 400,000 weight units and every byte weighs at least one. The
// shortest possible transaction (one input and one output, both with empty scripts) is 60 bytes.
// The Worker's /v1/tx/send applies the same bounds.
export const RAW_TX_MAX_BYTES = 400_000;
const MIN_BYTES = 60;

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function polymod(values: number[]) {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i];
  }
  return chk >>> 0;
}
/// A segwit address (BIP 173 bech32 for version 0, BIP 350 bech32m for 1 and up).
export function segwitAddress(hrp: string, version: number, program: Uint8Array) {
  const data = [version];
  let acc = 0, bits = 0;
  for (const byte of program) {
    acc = (acc << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; data.push((acc >>> bits) & 31); }
  }
  if (bits) data.push((acc << (5 - bits)) & 31);
  const expanded = [...hrp].map((c) => c.charCodeAt(0) >> 5).concat(0, [...hrp].map((c) => c.charCodeAt(0) & 31));
  const mod = (polymod([...expanded, ...data, 0, 0, 0, 0, 0, 0]) ^ (version === 0 ? 1 : 0x2bc830a3)) >>> 0;
  const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...checksum].map((d) => CHARSET[d]).join("")}`;
}
/// The address an output script pays. Pearl's addresses are segwit (prl1…), so other scripts have none:
/// null, with `data` for an OP_RETURN output, as the Worker's /v1/tx rows.
export function outputRow(script: Uint8Array, value: bigint): TxRow {
  const n = script.length, op = script[0];
  const version = op === 0 ? 0 : op >= 0x51 && op <= 0x60 ? op - 0x50 : -1;
  // A witness program is 2–40 bytes after its version opcode and one push; version 0 is 20 or 32.
  const witness = version >= 0 && n >= 4 && n <= 42 && script[1] === n - 2 && (version !== 0 || n === 22 || n === 34);
  return witness ? { address: segwitAddress("prl", version, script.subarray(2)), value: value.toString() }
    : { address: null, value: value.toString(), data: op === 0x6a };
}

// An unsigned 32-bit little-endian number at x[i].
const le = (x: Uint8Array, i: number) => (x[i] | x[i + 1] << 8 | x[i + 2] << 16) + x[i + 3] * 0x1000000;
const sha256 = async (bytes: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));

/// Decodes a signed raw transaction as hex (any case; spaces and line breaks are ignored), or returns
/// null when it is not one: bad hex, too short or long, a truncated or overlong encoding, no inputs or
/// no outputs.
export async function decodeRawTx(input: string): Promise<RawTx | null> {
  const hex = input.replace(/\s+/g, "").toLowerCase();
  if (hex.length < 2 * MIN_BYTES || hex.length > 2 * RAW_TX_MAX_BYTES || !/^(?:[0-9a-f]{2})+$/.test(hex)) return null;
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  let at = 0;
  const take = (n: number) => {
    if (n < 0 || at + n > b.length) throw new RangeError("truncated");
    at += n;
    return b.subarray(at - n, at);
  };
  // CompactSize, which nodes accept only in its shortest form.
  const count = () => {
    const first = take(1)[0];
    if (first < 0xfd) return first;
    // Eight-byte counts are far beyond any transaction.
    if (first === 0xff) throw new RangeError("too large");
    const x = take(first === 0xfd ? 2 : 4), n = first === 0xfd ? x[0] | x[1] << 8 : le(x, 0);
    if (n < (first === 0xfd ? 0xfd : 0x10000)) throw new RangeError("non-canonical");
    // No count can exceed the bytes left (each entry takes at least one).
    if (n > b.length - at) throw new RangeError("truncated");
    return n;
  };
  try {
    take(4);
    // BIP 144: a 0x00 marker and 0x01 flag, then the witnesses after the outputs.
    const segwit = b[at] === 0;
    if (segwit && take(2)[1] !== 1) return null;
    const body = at;
    const inputCount = count();
    if (inputCount < 1) return null;
    for (let i = 0; i < inputCount; i++) { take(36); take(count()); take(4); }
    const outputCount = count();
    if (outputCount < 1) return null;
    const outputs: TxRow[] = [];
    let value = 0n;
    for (let i = 0; i < outputCount; i++) {
      const v = take(8), amount = BigInt(le(v, 0)) + (BigInt(le(v, 4)) << 32n);
      value += amount;
      outputs.push(outputRow(take(count()), amount));
    }
    const bodyEnd = at;
    if (segwit) for (let i = 0; i < inputCount; i++) for (let items = count(); items > 0; items--) take(count());
    take(4);
    if (at !== b.length) return null;
    // The txid hashes the transaction without its witnesses, and is shown byte-reversed.
    const stripped = segwit ? new Uint8Array([...b.subarray(0, 4), ...b.subarray(body, bodyEnd), ...b.subarray(b.length - 4)]) : b;
    const txid = [...(await sha256(await sha256(stripped)))].reverse().map((x) => x.toString(16).padStart(2, "0")).join("");
    const weight = stripped.length * 3 + b.length;
    return { hex, txid, size: b.length, vsize: Math.ceil(weight / 4), inputCount, outputs, value: value.toString() };
  } catch {
    return null;
  }
}
