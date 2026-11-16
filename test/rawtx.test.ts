import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { decodeRawTx, segwitAddress, RAW_TX_MAX_BYTES } from "../src/rawtx.ts";

// Mainnet transactions as Blockbook returned them on 2026-10-20 (txid, size and vsize are Blockbook's).
const spend = {
  txid: "1ed0db5b05e655aabf0d47d60510f546ec3db3a69fa8a9a731813cd643a34b2a",
  hex: "0100000000010159ad28e9495a5eb4ec4ebe44c18bb2d13f4b2c569d08cf4f68bef7ae2f96ade7cf00000000ffffffff02637c5f0900000000225120efb37af4647139856292b7694e04e14b4d230becc8c358edced26912a279c42b9c20000000000000225120a3149191e2948bf7f022f8f2b202a8b889968967018959c163377e72738d78f601402f1158ac98b6bd89671f9f85956c817d282c9f440285cbd0d2fe12da0971ee59441e3e218a9d2e7c28e4f78510b7f48a1c27a6c525a05c35f8d6e2f7ae6ade8800000000",
};
const coinbase = {
  txid: "fbbb96eb840f79e9b166f613ceac23bfb5d4ba4acd995faa21eece2f1cfd7a3c",
  hex: "020000000001010000000000000000000000000000000000000000000000000000000000000000ffffffff5b03e1fd0104f3d2d66a2f706f6f6c2e6b7279707465782e636f6d2f4e4f434b434841494e2d41492d504f572d4155589ac9a10e41cb2b60b3bb037f55382d34c1d645004b3082e2e320da8b2561138410036e055787b073a3677377ffffffff02ecd0a42734000000225120e31e8032a67b9af27dc279f448c003457bae6c5d28de7ee719bc87b6801ede170000000000000000266a24aa21a9ede2f61c3f71d1defd3fa999dfa36953755c690689799962b48bebd836974e8cf90120000000000000000000000000000000000000000000000000000000000000000000000000",
};
const sha256d = (b: Buffer) => createHash("sha256").update(createHash("sha256").update(b).digest()).digest();
const le = (n: number, bytes: number) => Buffer.from(Array.from({ length: bytes }, (_, i) => Math.floor(n / 256 ** i) % 256));
const p2tr = (fill: number) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, fill)]);
// A legacy (no witness) transaction: one input, then the outputs given as [value, script].
const legacy = (outputs: [number, Buffer][], count = (n: number) => n < 0xfd ? le(n, 1) : Buffer.concat([Buffer.from([0xfd]), le(n, 2)])) => Buffer.concat([
  le(2, 4), le(1, 1), Buffer.alloc(32, 7), le(1, 4), le(0, 1), le(0xffffffff, 4),
  count(outputs.length), ...outputs.flatMap(([v, s]) => [le(v, 8), le(s.length, 1), s]), le(0, 4),
]);

test("raw tx: a mainnet spend decodes to Blockbook's txid, size, vsize and outputs", async () => {
  const tx = await decodeRawTx(spend.hex);
  assert.deepEqual(tx, {
    hex: spend.hex, txid: spend.txid, size: 205, vsize: 154, inputCount: 1, value: "157261055",
    outputs: [
      { address: "prl1pa7eh4arywyuc2c5jka55up8pfdxjxzlverp43mww6f539gnecs4s995upc", value: "157252707" },
      { address: "prl1p5v2fry0zjj9l0upzlretyq4ghzyedzt8qxy4nstrxal8yuud0rmqj9jlrf", value: "8348" },
    ],
  });
  // Pasted in upper case and wrapped over lines.
  const wrapped = ` ${spend.hex.slice(0, 64).toUpperCase()}\n${spend.hex.slice(64, 200)}\r\n\t${spend.hex.slice(200)} `;
  assert.equal((await decodeRawTx(wrapped))?.hex, spend.hex);
});

test("raw tx: a coinbase's OP_RETURN commitment is a data output", async () => {
  const tx = await decodeRawTx(coinbase.hex);
  assert.equal(tx?.txid, coinbase.txid);
  assert.equal(tx?.size, 268); assert.equal(tx?.vsize, 241);
  assert.deepEqual(tx?.outputs, [
    { address: "prl1puv0gqv4x0wd0ylwz086y3sqrg4a6umza9r08aecehjrmdqq7mctsmqaqsh", value: "224003412204" },
    { address: null, value: "0", data: true },
  ]);
});

test("raw tx: a legacy transaction with 253 outputs (a three-byte count), version 0 and other scripts", async () => {
  const outputs: [number, Buffer][] = Array.from({ length: 253 }, (_, i) => [1000 + i, p2tr(i)]);
  outputs[1] = [5, Buffer.concat([Buffer.from([0x00, 0x14]), Buffer.from("751e76e8199196d454941c45d1b3a323f1433bd6", "hex")])];
  outputs[2] = [6, Buffer.from("76a914" + "11".repeat(20) + "88ac", "hex")];
  outputs[3] = [7, Buffer.from([0x51, 0x02, 0xab, 0xcd])];
  outputs[4] = [8, Buffer.concat([Buffer.from([0x00, 0x15]), Buffer.alloc(21)])];
  const raw = legacy(outputs), tx = await decodeRawTx(raw.toString("hex"));
  assert.equal(tx?.txid, Buffer.from(sha256d(raw)).reverse().toString("hex"));
  assert.equal(tx?.size, raw.length); assert.equal(tx?.vsize, raw.length);
  assert.equal(tx?.outputs.length, 253);
  assert.equal(tx?.value, String(outputs.reduce((n, [v]) => n + v, 0)));
  // BIP 173's version-0 vector under the prl prefix: the same data part, its own checksum.
  assert.match(tx?.outputs[1].address ?? "", /^prl1qw508d6qejxtdg4y5r3zarvary0c5xw7k[02-9ac-hj-np-z]{6}$/);
  assert.deepEqual(tx?.outputs[2], { address: null, value: "6", data: false }, "P2PKH has no prl1 address");
  assert.match(tx?.outputs[3].address ?? "", /^prl1p[02-9ac-hj-np-z]{10}$/, "a two-byte version 1 program");
  assert.equal(tx?.outputs[4].address, null, "version 0 is only 20 or 32 bytes");
});

test("raw tx: segwit addresses match the BIP 173 and BIP 350 test vectors", () => {
  assert.equal(segwitAddress("bc", 0, Buffer.from("751e76e8199196d454941c45d1b3a323f1433bd6", "hex")), "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
  assert.equal(segwitAddress("bc", 1, Buffer.from("79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", "hex")), "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0");
  assert.equal(segwitAddress("tb", 0, Buffer.from("000000c4a5cad46221b2a187905e5266362b99d5e91c6ce24d165dab93e86433", "hex")), "tb1qqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesrxh6hy");
  assert.equal(segwitAddress("bc", 16, Buffer.from("751e", "hex")), "bc1sw50qgdz25j");
});

test("raw tx: anything that is not exactly one transaction is null", async () => {
  const one: [number, Buffer][] = [[1, p2tr(1)]];
  const good = legacy(one).toString("hex");
  assert.ok(await decodeRawTx(good));
  const swap = (at: number, with_: string) => spend.hex.slice(0, at) + with_ + spend.hex.slice(at + with_.length);
  for (const [why, bad] of [
    ["empty", ""], ["not hex", spend.hex.replace("0100", "01zz")], ["odd length", spend.hex + "0"],
    ["trailing byte", spend.hex + "00"], ["truncated", spend.hex.slice(0, -2)], ["a txid", spend.txid],
    ["witness flag other than 1", swap(10, "02")], ["no inputs", legacy(one).toString("hex").replace(/^02000000(01)/, "0200000000")],
    ["no outputs", legacy([]).toString("hex").padEnd(120, "0")],
    ["a three-byte count for a small number", legacy(one, (n) => Buffer.concat([Buffer.from([0xfd]), le(n, 2)])).toString("hex")],
    ["an eight-byte count", legacy(one, () => Buffer.from([0xff, 1, 0, 0, 0, 0, 0, 0, 0])).toString("hex")],
    ["a count beyond the bytes left", legacy(one, () => Buffer.from([0xfe, 0xff, 0xff, 0xff, 0x7f])).toString("hex")],
    ["too long", "00".repeat(RAW_TX_MAX_BYTES + 1)],
  ] as const) assert.equal(await decodeRawTx(bad), null, why);
});
