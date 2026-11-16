import { test } from "node:test";
import assert from "node:assert/strict";
import { incomeLabel, incomeSetting, incomeWire, knownAddresses, normalizeIncomeAddress, parseIncome, readIncome, writeIncome, readKnownWallets, writeKnownWallets, shortAddress, INCOME_KEY } from "../src/income-alert.ts";

// The iOS tests' address (prl-hub Tests/OfflineAlertTests.swift IncomeAlertTests).
const addr = "prl1p8wznc8tkhlkjaq7v8ycugz93rgs8uezq6px7873934kh35nk9q2qlz0q9m";
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };

test("到账提醒 takes a mainnet address however it was pasted (IncomeAlertStore.normalize)", () => {
  assert.equal(normalizeIncomeAddress(addr), addr);
  assert.equal(normalizeIncomeAddress(`  ${addr.toUpperCase()}\n`), addr);
  assert.equal(normalizeIncomeAddress(`pearl:${addr}?amount=1`), addr);
  assert.equal(normalizeIncomeAddress(addr.slice(0, -1) + "x"), null, "bad checksum");
  assert.equal(normalizeIncomeAddress("t" + addr), null, "testnet");
  assert.equal(normalizeIncomeAddress(""), null);
});

test("the name is one line of at most 40 UTF-16 units, cut at whole characters", () => {
  assert.equal(incomeLabel(" Main\nwallet "), "Main wallet");
  assert.equal(incomeLabel("a".repeat(45)).length, 40);
  const emoji = incomeLabel("😀".repeat(25));
  assert.equal(emoji.length, 40);
  assert.equal([...emoji].length, 20);
});

test("only an alert that is on goes to the Worker, with its name when it has one", () => {
  assert.deepEqual(incomeWire(incomeSetting(addr, "Main")), { addr, label: "Main" });
  assert.deepEqual(incomeWire(incomeSetting(addr)), { addr });
  assert.equal(incomeWire(incomeSetting(addr, "Main", false)), null);
  assert.equal(incomeWire(null), null);
  assert.equal(incomeSetting("nope"), null);
});

test("kept as it is sent, dropped when unreadable", () => {
  const s = memory();
  assert.equal(readIncome(s), null);
  writeIncome({ addr, label: "Main", on: false }, s);
  assert.deepEqual(readIncome(s), { addr, label: "Main", on: false });
  s.setItem(INCOME_KEY, JSON.stringify({ addr: "nope" }));
  assert.equal(readIncome(s), null);
  s.setItem(INCOME_KEY, "{");
  assert.equal(readIncome(s), null);
  assert.equal(parseIncome({ addr: addr.toUpperCase() }), null, "stored as normalized only");
  writeIncome(null, s);
  assert.equal(s.m.has(INCOME_KEY), false);
});

test("the menu: wallets first, then monitors' payout addresses, each once; no F2Pool links", () => {
  const other = "prl1pqypqxpq9qcrsszg2pvxq6rs0zqg3yyc5z5tpwxqergd3c8g7rusqk96rj8";
  const known = knownAddresses(
    [{ name: "Main", address: addr }, { name: "Watch", address: other }, { name: "Twin", address: addr.toUpperCase() }, { name: "Testnet", address: "t" + addr }],
    [{ pool: "Kryptex", addr, label: "Garage" }, { pool: "F2Pool", addr: "0123456789abcdef0123456789abcdef", label: "F2" },
     { pool: "AlphaPool", addr: other, label: "Dup" }, { pool: "AlphaPool", addr: "prl1bad", label: "Bad" }]);
  assert.deepEqual(known, [{ name: "Main", addr, kind: "wallet" }, { name: "Watch", addr: other, kind: "wallet" }]);
  const monitorsOnly = knownAddresses([], [{ pool: "Kryptex", addr, label: "Garage" }, { pool: "Kryptex", addr: other, label: "Gone", deleted: true }]);
  assert.deepEqual(monitorsOnly, [{ name: "Garage", addr, kind: "monitor" }]);
});

test("wallet addresses as last seen unlocked: public addresses only, bad entries dropped", () => {
  const s = memory();
  assert.deepEqual(readKnownWallets(s), []);
  writeKnownWallets([{ name: "Main", address: addr, readOnly: true } as { name: string; address: string }], s);
  assert.deepEqual(readKnownWallets(s), [{ name: "Main", address: addr }]);
  s.setItem("pearlhub.incomeWallets", JSON.stringify([{ name: "x", address: "nope" }, { name: 1, address: addr }, null]));
  assert.deepEqual(readKnownWallets(s), []);
  assert.equal(shortAddress(addr), "prl1p8wznc…lz0q9m");
});
