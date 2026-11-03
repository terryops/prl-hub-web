// What the Android app page offers the wallet frame (same origin, window.parent.__pearlApp).
// The wallet follows the app's language, currency and appearance, keeps its address book in
// the app's configuration (so Pro accounts sync it like the native app's), and asks the app
// to open other tabs.
import type { Lang } from "./types.ts";

export type HostPrefs = { lang: Lang; secondary: string; theme: "light" | "dark"; palette: "classic" | "mono" };
export type PearlHost = {
  prefs(): HostPrefs;
  contacts(): unknown[];
  setContacts(next: unknown[]): void;
  subscribe(listener: () => void): () => void;
  openPage(hash: string): void;
  // The 钱包 tab is on screen with nothing over it (the wallet's one-time donation ask waits for that).
  visible?(): boolean;
  // The wallet's iOS one-line links: 价格提醒 (Pro, live rules) and 桌面小组件 (hidden once one is placed).
  alerts?(): { pro: boolean; active: number; ready?: boolean };
  widgetPlaced?(): boolean;
  open?(target: "alerts" | "widgets"): void;
  // The account's web 钱包 page and this device's wallets, as in the iOS app (WebSharedMerge.wallets): the
  // wallet hands over its rows (walletRows) and gets back what to change about its read-only wallets, and
  // calls commit() once it has, naming any address it couldn't take in (a full list): only then does the
  // app record what both sides agreed on, as a change left unapplied would otherwise read as "removed here"
  // next time and remove the web's entry. Null while no account syncs (signed out, or not Pro): the iOS app
  // syncs only a linked account too.
  syncWallets?(rows: WalletRow[]): { changes: WalletChanges; commit(skipped?: string[]): void } | null;
};

/// One of this device's wallets as an entry of the web's 钱包 page: its mainnet main address (#0) under its
/// name. The id comes from the address (walletRowId), so the same wallet on two devices is one entry.
/// `watch`: a read-only wallet here, which follows the web both ways; it never leaves the device.
export type WalletRow = { id: string; addr: string; label: string; watch?: boolean };
/// Read-only wallets to add, rename or remove here because of the web's 钱包 page, by address.
export type WalletChanges = { added: { addr: string; label: string }[]; renamed: Record<string, string>; removed: string[] };
type WebWallet = { id: string; updated: number; deleted?: boolean; addr?: string; label?: string; [key: string]: unknown };

/// The web's cap on 钱包 entries (web/src/store.ts normalizeConfig); one more and it refuses the configuration.
export const MAX_WEB_WALLETS = 10;
const WEB_ADDRESS = /^prl1[0-9a-z]{20,100}$/;

/// iOS WebSharedMerge.walletRows: "w-" and the first 32 hex digits of the address's SHA-256.
export async function walletRowId(addr: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(addr)));
  return "w-" + [...digest].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
export async function walletRows(wallets: { addr: string; label: string; watch?: boolean }[]): Promise<WalletRow[]> {
  const seen = new Set<string>(), rows: WalletRow[] = [];
  for (const w of wallets) {
    if (!WEB_ADDRESS.test(w.addr) || seen.has(w.addr)) continue;
    seen.add(w.addr);
    // The web counts UTF-16 units; drop whole characters until it fits.
    const chars = [...(w.label.trim() || "Pearl Wallet")];
    while (chars.join("").length > 40) chars.pop();
    rows.push({ id: await walletRowId(w.addr), addr: w.addr, label: chars.join(""), ...(w.watch ? { watch: true } : {}) });
  }
  return rows;
}

/// iOS WebSharedMerge.wallets, both ways for read-only wallets and one way for the others:
/// - every wallet here goes to the web; one with its seed here is never changed or removed by the web — an
///   entry renamed or removed there stays that way until the wallet itself changes here;
/// - every other live entry there (an address added on the web, another device's wallet) becomes a read-only
///   wallet here, and renaming or removing a read-only wallet on either side does the same on the other.
///   When both renamed it, the web's name wins.
/// `base`: id → the entry's content as both sides last agreed (pushed from here, or taken in).
export function mergeWallets(mine: WalletRow[], remote: WebWallet[], old: Record<string, string>, now: number) {
  const rows: WebWallet[] = remote.map((r) => ({ ...r })), base: Record<string, string> = {};
  const native: WalletChanges = { added: [], renamed: {}, removed: [] }, removed = new Set<string>();
  let changed = false;
  const isLive = (row: WebWallet) => row.deleted !== true;
  const stamp = (row: WebWallet) => Math.max(now, Number.isSafeInteger(row.updated) ? row.updated : 0) + 1;
  const entry = (addr: string, label: string) => JSON.stringify({ addr, label });
  const agreed = (id: string): { addr: string; label: string } | undefined => {
    try { const o = JSON.parse(old[id] ?? "null"); return typeof o?.addr === "string" && typeof o?.label === "string" ? o : undefined; } catch { return undefined; }
  };
  let live = rows.filter(isLive).length;
  const mineIds = new Set(mine.map((r) => r.id));
  const here = new Map(mine.map((r) => [r.addr, { label: r.label, watch: r.watch === true }]));   // address → this device's wallet
  // Read-only wallets taken in from an entry there with another id: that entry stands for them (step 2), so
  // they're never pushed again under their own.
  const rowIds = new Set(rows.map((r) => r.id));
  const linked = new Set(Object.keys(old).filter((id) => !mineIds.has(id) && rowIds.has(id)).flatMap((id) => agreed(id)?.addr ?? []));
  // 1. This device's wallets.
  for (const row of mine) {
    const { id, addr, label } = row;
    if (old[id] === undefined && row.watch && linked.has(addr)) continue;
    const content = entry(addr, label);
    const index = rows.findIndex((r) => r.id === id);
    if (old[id] === content) {
      // Unchanged here since the last sync: a read-only wallet follows what the web did.
      if (row.watch && index >= 0) {
        const theirs = rows[index];
        if (!isLive(theirs)) { removed.add(addr); continue; }
        if (theirs.addr === addr && typeof theirs.label === "string" && theirs.label && theirs.label !== label) {
          native.renamed[addr] = theirs.label; base[id] = entry(addr, theirs.label); continue;
        }
      }
      base[id] = content; continue;
    }
    // The web already watches this address under an entry of its own: no twin.
    if (rows.some((r) => isLive(r) && r.addr === addr && r.id !== id)) continue;
    const wasLive = index >= 0 && isLive(rows[index]);
    if (!wasLive && live >= MAX_WEB_WALLETS) continue;   // full: try again on a later sync
    const next: WebWallet = { ...(index >= 0 ? rows[index] : {}), id, addr, label, updated: 0 };
    delete next.deleted;
    next.updated = stamp(index >= 0 ? rows[index] : next);
    if (index >= 0) rows[index] = next; else rows.push(next);
    if (!wasLive) live++;
    base[id] = content; changed = true;
  }
  // 2. Every other entry: the web's own, another device's, or one of ours removed here.
  for (const [i, row] of rows.entries()) {
    if (mineIds.has(row.id)) continue;
    if (!isLive(row)) {
      // Removed on the web: so goes the read-only wallet it became here.
      const prior = agreed(row.id);
      if (prior && here.get(prior.addr)?.watch) removed.add(prior.addr);
      continue;
    }
    const { addr, label } = row;
    if (typeof addr !== "string" || !WEB_ADDRESS.test(addr) || typeof label !== "string") continue;
    const content = entry(addr, label);
    const mineHere = here.get(addr);
    if (mineHere) {
      // Already a wallet here (a read-only one taken in earlier, or its seed is here).
      if (!mineHere.watch) continue;
      const prior = agreed(row.id);
      if (prior && entry(prior.addr, prior.label) === content && mineHere.label !== label) {
        // Renamed here: rename the entry there.
        rows[i] = { ...row, label: mineHere.label, updated: stamp(row) };
        base[row.id] = entry(addr, mineHere.label); changed = true;
      } else {
        if (mineHere.label !== label && label) native.renamed[addr] = label;
        base[row.id] = content;
      }
    } else if (old[row.id] !== undefined) {
      // It was a wallet here (ours, or one taken in) and was removed here.
      rows[i] = { id: row.id, deleted: true, updated: stamp(row) };
      changed = true;
    } else {
      native.added.push({ addr, label });
      base[row.id] = content;
    }
  }
  native.removed = [...removed];
  return { rows, base, changed, native };
}
/// `base` without the entries for `skipped` addresses (web entries this device couldn't take in), so the next
/// sync offers them again instead of reading them as removed here.
export function withoutSkipped(base: Record<string, string>, skipped: string[]) {
  if (!skipped.length) return base;
  const drop = new Set(skipped);
  return Object.fromEntries(Object.entries(base).filter(([, content]) => { try { return !drop.has(JSON.parse(content).addr); } catch { return true; } }));
}
/// Whether a merge asks this device to change anything.
export const walletChangesEmpty = (c: WalletChanges) => !c.added.length && !c.removed.length && !Object.keys(c.renamed).length;

declare global {
  interface Window { __pearlApp?: PearlHost }
}

export function pearlHost(): PearlHost | undefined {
  try { return window.parent !== window ? window.parent.__pearlApp : window.__pearlApp; }
  catch { return undefined; }
}

type Row = { id: string; updated: number; deleted?: boolean; name?: string; address?: string; note?: string; [key: string]: unknown };
const content = (c: Partial<Row>) => JSON.stringify([c.name, c.address, c.note]);

// The wallet writes its whole live list; the configuration keeps change stamps and deletion
// tombstones so another device's edits merge instead of being overwritten.
export function contactsFromWallet<T extends { id: string; updated: number; deleted?: boolean }>(current: T[], next: unknown[], stamp: () => number): T[] {
  const byId = new Map((current as unknown as Row[]).map((c) => [c.id, c]));
  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const raw of next) {
    const row = raw as Partial<Row> | null;
    if (!row || typeof row.id !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(row.id) || seen.has(row.id)) continue;
    seen.add(row.id);
    const old = byId.get(row.id);
    const { updated: _updated, deleted: _deleted, ...fields } = row;
    if (old && !old.deleted && content(old) === content(fields)) rows.push(old);
    else rows.push({ ...old, ...fields, id: row.id, deleted: undefined, updated: Math.max(stamp(), (old?.updated || 0) + 1) } as Row);
  }
  for (const old of current as unknown as Row[]) {
    if (seen.has(old.id)) continue;
    rows.push(old.deleted ? old : { ...old, deleted: true, updated: Math.max(stamp(), old.updated + 1) });
  }
  return rows.map((r) => { if (r.deleted === undefined) { const { deleted: _d, ...rest } = r; return rest as Row; } return r; }) as unknown as T[];
}

// What the wallet frame offers the app page (window.__pearlWallet in the frame): the 设置 tab's
// 钱包与安全 and Pearl 网络 pages, as in the iOS app, drive the wallet through it.
export type WalletTarget = "wallets" | "contacts" | "backup" | "recover" | "remove";
export type WalletState = { exists: boolean; locked: boolean; count: number; network: "mainnet" | "testnet" | null;
  // The selected wallet's main mainnet address while unlocked (我的监控's 用我的钱包地址).
  address?: string | null;
  // The selected wallet only watches an address (no seed): 查看助记词, 找回搁浅的找零, NOCK and 从钱包转入 don't apply.
  readOnly?: boolean;
  // 设置 → 钱包与安全's 在钱包页显示 NOCK 钱包: whether the wallet page's NOCK line shows; null when the switch
  // doesn't apply (locked, a read-only wallet, or one that uses NOCK and always shows its strip).
  nockLink?: "shown" | "hidden" | null };
export type WalletControl = {
  state(): WalletState;
  open(target: WalletTarget): void;
  lock(): void;
  setNetwork(network: "mainnet" | "testnet"): Promise<boolean>;
  subscribe(listener: () => void): () => void;
  // A quiet chain refresh when the 钱包 tab comes back into view (iOS refreshes on appear and on foreground).
  refresh?(): void;
  // The 交易 tab's 提现 (iOS 我的钱包): the main mainnet address of every wallet with its seed here, while
  // unlocked on mainnet. Read-only wallets are left out: the address they watch may well be someone else's.
  wallets?(): { name: string; address: string }[];
  // The 交易 tab's 充值 → 从钱包转入: the send screen with this address filled in (amount, fee and the device
  // check stay the person's). Locked: it opens once the wallet is unlocked; false then, off mainnet, or when
  // the selected wallet is read-only (it can't send).
  send?(address: string): boolean;
  // Shows or hides the wallet page's NOCK line (WalletState.nockLink).
  setNockLink?(shown: boolean): void;
};

declare global {
  interface Window { __pearlWallet?: WalletControl }
}
