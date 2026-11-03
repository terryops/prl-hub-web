// The Android shell's message channel (BRIDGE.md in the prl-hub-android repository). Shared by the app page and the
// wallet frame; both run at https://pearlhub.net inside the app's WebView, where the shell
// injects window.PearlAndroid for that origin only. Absent everywhere else.
type Channel = {
  postMessage(message: string): void;
  addEventListener?(type: "message", listener: (event: { data: unknown }) => void): void;
  onmessage?: ((event: { data: unknown }) => void) | null;
};
type Reply = { id?: string; ok?: boolean; result?: unknown; error?: string };

declare global {
  interface Window {
    PearlAndroid?: Channel;
    __pearlEvent?: (name: string, data?: unknown) => void;
    __pearlBack?: () => boolean;
  }
}

export class BridgeError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}

const channel = (): Channel | undefined => typeof window === "undefined" ? undefined : window.PearlAndroid;
export const hasBridge = () => !!channel();

let sequence = 0, listening: Channel | undefined;
const waiting = new Map<string, { resolve: (value: unknown) => void; reject: (error: BridgeError) => void; timer?: ReturnType<typeof setTimeout> }>();
function settle(data: unknown) {
  let reply: Reply;
  try { reply = typeof data === "string" ? JSON.parse(data) : data as Reply; } catch { return; }
  const entry = reply?.id ? waiting.get(reply.id) : undefined;
  if (!entry) return;
  waiting.delete(reply.id!);
  clearTimeout(entry.timer);
  if (reply.ok) entry.resolve(reply.result ?? {});
  else entry.reject(new BridgeError(typeof reply.error === "string" ? reply.error : "failed"));
}
function listen(target: Channel) {
  if (listening === target) return;
  listening = target;
  if (target.addEventListener) target.addEventListener("message", (event) => settle(event.data));
  else target.onmessage = (event) => settle(event.data);
}

// Biometric prompts wait for the person, so they pass timeout 0.
export function nativeCall<T = Record<string, never>>(method: string, params: Record<string, unknown> = {}, timeout = 30000): Promise<T> {
  const target = channel();
  if (!target) return Promise.reject(new BridgeError("unavailable"));
  listen(target);
  const id = `${Date.now().toString(36)}-${++sequence}`;
  return new Promise<T>((resolve, reject) => {
    const entry: { resolve: (value: unknown) => void; reject: (error: BridgeError) => void; timer?: ReturnType<typeof setTimeout> } = { resolve: resolve as (value: unknown) => void, reject };
    if (timeout > 0) entry.timer = setTimeout(() => { waiting.delete(id); reject(new BridgeError("timeout")); }, timeout);
    waiting.set(id, entry);
    try { target.postMessage(JSON.stringify({ id, method, params })); }
    catch { waiting.delete(id); clearTimeout(entry.timer); reject(new BridgeError("unavailable")); }
  });
}

// Copy and paste go through the shell: the WebView's async clipboard needs page focus and a
// permission the app cannot show. Links that leave the app open in the system browser.
export function installNativeHelpers(doc: Document = document) {
  if (!hasBridge()) return;
  const clipboard = {
    writeText: (text: string) => nativeCall("clipboard.write", { text }).then(() => undefined),
    readText: () => nativeCall<{ text: string }>("clipboard.read").then((r) => r.text || ""),
  };
  try { Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard }); }
  catch { /* The shell still offers copy through its own menu. */ }
  doc.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!link) return;
    const url = new URL(link.href, doc.baseURI);
    if (link.target === "_blank" || url.origin !== "https://pearlhub.net") {
      event.preventDefault();
      void nativeCall("openExternal", { url: url.href }).catch(() => {});
    }
  }, true);
}
