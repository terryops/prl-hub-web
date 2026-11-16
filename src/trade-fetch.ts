// The website's read-only 交易 page has no Android shell to send exchange requests, so the public market reads
// (ticker, rules, depth, k-line) go straight from the browser: SafeTrade and Gate both answer CORS for those
// (web/public/_headers allows both in connect-src). Signed requests still need the shell: the exchanges refuse
// a browser's preflight for them, and an API secret has no business in a web page.
import { TradeError } from "./safetrade.ts";

export async function publicGet(origin: string, path: string, query?: Record<string, string>): Promise<string> {
  const qs = query ? new URLSearchParams(query).toString() : "";
  let r: Response;
  try {
    r = await fetch(`${origin}${path}${qs ? `?${qs}` : ""}`, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", signal: AbortSignal.timeout(15000) });
  } catch {
    throw new TradeError({ kind: "unreached" });
  }
  const body = await r.text().catch(() => "");
  if (r.ok) return body;
  throw new TradeError({ kind: "http", status: r.status, body });
}
