import type { Order } from "./types.ts";
// Quote expiry matters only while the user has not paid. Seen payments keep
// their amount and order until confirmation, even after a browser reload.
export const quoteExpired = (order: Pick<Order, "status" | "expires_at">, clock: number) =>
  order.status === "pending" && clock >= order.expires_at * 1000;
