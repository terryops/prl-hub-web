import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeConfig, normalizeConfig, orderedMonitors, sameConfig, alive } from "../src/store.ts";

// The native app links to the web with a sync code and writes the same configuration
// (Sources/App/WebLinkMerge.swift). Its tests build exactly this file; here the validator
// every browser runs must take it, because one bad entry rejects the whole configuration.
const sample = JSON.parse(readFileSync(new URL("./fixtures/weblink_config.json", import.meta.url), "utf8"));

test("a configuration written by the app is one every browser accepts", () => {
  const c = normalizeConfig(sample);
  assert.equal(c.monitors.length, 3);
  assert.equal(c.rules.length, 2);
  assert.deepEqual(c.window, { start: 480, end: 1380, tz: "Asia/Shanghai" });
  // Uppercase ids (the app's UUIDs) and the card order survive as written.
  assert.deepEqual(orderedMonitors(c).map((m) => m.id), sample.monitorOrder.ids);
  assert.equal(orderedMonitors(c)[2].paused, true);
  assert.equal(c.monitors.find((m) => m.pool === "F2Pool")?.acct, "My Rig");
});

test("merging it with a browser's own configuration keeps both sides' entries", () => {
  const app = normalizeConfig(sample);
  const browser = normalizeConfig({
    lang: "en", settingsUpdated: 5, window: null, wallets: [],
    monitors: [{ id: "0a1b2c3d-0000-4000-8000-00000000abcd", updated: 9, pool: "Lucky Pool", label: "Web", alert: false, after: 600,
      addr: "prl1p8wznc8tkhlkjaq7v8ycugz93rgs8uezq6px7873934kh35nk9q2qlz0q9m" }],
    rules: [{ id: "web-rule-1", updated: 9, kind: "below", value: 0.5, window: 0, enabled: true, seen_fired: 0 }],
  });
  const merged = mergeConfig(browser, app);
  assert.equal(alive(merged.monitors).length, 4);
  assert.equal(alive(merged.rules).length, 3);
  // The app's settings carry the later stamp, so its push hours are the ones kept.
  assert.deepEqual(merged.window, app.window);
  // Either order of merging settles on the same configuration.
  assert.ok(sameConfig(merged, mergeConfig(app, browser)));
  // A monitor the app deleted stays deleted: its tombstone is all the app sends.
  const gone = normalizeConfig({ ...sample, monitors: [{ id: sample.monitors[0].id, updated: sample.monitors[0].updated + 1, deleted: true }] });
  assert.equal(alive(mergeConfig(merged, gone).monitors).some((m) => m.id === sample.monitors[0].id), false);
});
