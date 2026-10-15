import { test } from "node:test";
import assert from "node:assert/strict";
import { appClient } from "../src/app-client.ts";

const session = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

test("app client: ?client=apple holds for the tab's session and nowhere else", () => {
  const g = globalThis as { sessionStorage?: unknown };
  g.sessionStorage = session();
  assert.equal(appClient(""), false);                          // a visit that starts on the site
  assert.equal(appClient("?account=manage&client=apple"), true);
  assert.equal(appClient("?page=alerts"), true);               // later pages in the same tab
  g.sessionStorage = session();                                // another tab / visit
  assert.equal(appClient("?page=alerts"), false);
  g.sessionStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(appClient("?client=apple"), true);              // storage blocked: the link alone still counts
  assert.equal(appClient(""), false);
  delete g.sessionStorage;
});
