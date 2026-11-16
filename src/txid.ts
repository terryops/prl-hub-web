import type { TxDetail, TxRow } from "./types.ts";

export const EXPLORER = "https://blockbook.pearlresearch.ai";

/// A txid typed or pasted as-is (any case, surrounding spaces), or inside an explorer link
/// such as https://blockbook.pearlresearch.ai/tx/<txid>. Null when there is none.
export function parseTxid(input: string): string | null {
  const s = input.trim();
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase();
  const m = /\/tx\/([0-9a-f]{64})(?![0-9a-z])/i.exec(s);
  return m ? m[1].toLowerCase() : null;
}

/// The rows of `tx` with the ones paying or spending a `known` address (address → label) first,
/// and the net change across those addresses (null when the transaction touches none of them).
export function txView(tx: TxDetail, known: ReadonlyMap<string, string>) {
  const mine = (r: TxRow) => r.address != null && known.has(r.address);
  const total = (rows: TxRow[]) => rows.filter(mine).reduce((n, r) => n + BigInt(r.value), 0n);
  const touched = tx.inputs.some(mine) || tx.outputs.some(mine);
  return { inputs: ownFirst(tx.inputs, known), outputs: ownFirst(tx.outputs, known), net: touched ? (total(tx.outputs) - total(tx.inputs)).toString() : null };
}

/// `rows` with the ones on a `known` address first, each group in its original order.
export function ownFirst(rows: TxRow[], known: ReadonlyMap<string, string>) {
  const mine = (r: TxRow) => r.address != null && known.has(r.address);
  return [...rows.filter(mine), ...rows.filter((r) => !mine(r))];
}
