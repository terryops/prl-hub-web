// Validation and precedence for the GPU reference table (see gpus.ts). Kept free of the JSON
// import and React so the Node tests can load it.
import type { GPU } from "./fleet.ts";

export type GPUCatalog = { updated: string; gpus: GPU[] };

const positive = (v: unknown, zero = false) => typeof v === "number" && Number.isFinite(v) && (zero ? v >= 0 : v > 0);
export function validCatalog(v: unknown): v is GPUCatalog {
  const c = v as GPUCatalog | null;
  return !!c && typeof c.updated === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.updated) && Array.isArray(c.gpus) && c.gpus.length > 0 &&
    c.gpus.every((g) => g && typeof g.name === "string" && g.name.length > 0 && positive(g.th) && positive(g.watts) && positive(g.price, true) && positive(g.rentDefault, true));
}
// The served table wins unless it is older than the bundled one (a deploy can lag a rebuild).
export const newest = (served: unknown, fallback: GPUCatalog): GPUCatalog =>
  validCatalog(served) && served.updated >= fallback.updated ? served : fallback;
