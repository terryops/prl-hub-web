// The GPU reference table (hashrate / power / price / rent per card). One file —
// Sources/PRLMonitor/gpus.json in the app repository — is bundled into the iOS / Mac app,
// served by the Worker at /v1/gpus, and copied here as the offline fallback
// (test/calculator.test.ts keeps the copy identical). The page switches to the served table
// once it loads, so revised figures reach the web without rebuilding it.
import { useEffect, useState } from "react";
import bundledCatalog from "./gpus.json";
import type { GPU } from "./fleet.ts";
import { newest, type GPUCatalog } from "./gpu-catalog.ts";

const bundled: GPUCatalog = bundledCatalog;
let current = bundled;
let pending: Promise<GPUCatalog> | null = null;
function load() {
  pending ||= fetch("/v1/gpus", { credentials: "same-origin", signal: AbortSignal.timeout(15000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((served) => (current = newest(served, bundled)))
    .catch(() => current);
  return pending;
}
export function useGPUs(): GPU[] {
  const [catalog, setCatalog] = useState(current);
  useEffect(() => {
    let mounted = true;
    load().then((c) => mounted && setCatalog(c));
    return () => { mounted = false; };
  }, []);
  return catalog.gpus;
}
