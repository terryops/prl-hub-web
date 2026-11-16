// The Android price-alert editor's rules match the iOS AlertEditorSheet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { priceRule, limitDecimals, number } from "../src/android-rule.ts";
import type { Rule } from "../src/types.ts";

test("android rule: a target above or below the current price picks the direction", () => {
  assert.deepEqual(priceRule(2, 1.85), { kind: "above", value: 2 });
  assert.deepEqual(priceRule(1.5, 1.85), { kind: "below", value: 1.5 });
  // No quote: above, as iOS assumes.
  assert.deepEqual(priceRule(1.5, undefined), { kind: "above", value: 1.5 });
});

test("android rule: the current price itself, and out-of-range targets, are refused", () => {
  assert.equal(priceRule(1.85, 1.8512), null);
  assert.equal(priceRule(0.004, 1), null);
  assert.equal(priceRule(1_000_000, 1), null);
});

test("android rule: an unchanged target keeps its direction even after the market crossed it", () => {
  const existing = { id: "r", kind: "above", value: 2, window: 0, enabled: true, seen_fired: 0, updated: 1 } as Rule;
  assert.deepEqual(priceRule(2, 2.5, existing), { kind: "above", value: 2 });
  assert.deepEqual(priceRule(2.1, 2.5, existing), { kind: "below", value: 2.1 });
});

test("android rule: input keeps digits, one separator and two decimals", () => {
  assert.equal(limitDecimals("1.2345"), "1.23");
  assert.equal(limitDecimals("1,5x6"), "1,56");
  assert.equal(limitDecimals("1..2"), "1.2");
  assert.equal(number("1,25"), 1.25);
  assert.equal(number(""), null);
});

test("android reach: either direction, unavailable quote, equality and bounds", () => {
  for (const current of [1, 3, undefined]) assert.deepEqual(priceRule(2, current, null, true), { kind: "reach", value: 2 });
  for (const target of [0, 1_000_000, NaN, Infinity]) assert.equal(priceRule(target, 1, null, true), null);
  assert.equal(priceRule(2, 2.004, null, true), null);
});

test("android reach: keep an unchanged reach rule; switching condition infers a direction", () => {
  const existing = { id: "r", kind: "reach", value: 2, window: 0, enabled: true, seen_fired: 0, updated: 1 } as Rule;
  assert.deepEqual(priceRule(2, 2, existing, true), { kind: "reach", value: 2 });
  assert.deepEqual(priceRule(2, 3, existing, false), { kind: "below", value: 2 });
  assert.equal(priceRule(2, 2, existing, false), null);
  assert.deepEqual(priceRule(2, 3, { ...existing, kind: "above" }, true), { kind: "reach", value: 2 });
});
