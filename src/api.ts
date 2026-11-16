import { configOf, mergeConfig, normalizeConfig, sameConfig } from "./store.ts";
import type { Config, State } from "./types.ts";
import { purchaseHeaders } from "./purchase-key.ts";
export class ApiError extends Error {
  status: number;
  // The error reply's body, e.g. /v1/tx/send's `reason`.
  data: Record<string, unknown>;
  constructor(error: string, status: number, data: Record<string, unknown> = {}) {
    super(error);
    this.status = status;
    this.data = data;
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  accountId = "",
): Promise<T> {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.timeout(30000),
    headers: {
      ...purchaseHeaders(),
      ...(accountId ? { "X-Account-ID": accountId } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // An error reply need not be JSON (a Cloudflare error page): its status still decides what is shown.
  let data;
  try { data = await response.json(); }
  catch (error) { if (response.ok) throw error; data = {}; }
  if (!response.ok)
    throw new ApiError(data?.error || "upstream", response.status, data ?? {});
  return data;
}
export async function syncConfig(
  state: State,
  latest: () => State,
): Promise<Config> {
  for (let i = 0; i < 3; i++) {
    if (latest().accountId !== state.accountId) throw new Error("identity_changed");
    const server = await api<{ schema_version: number; rev: number; data: Config | null }>(
      "/v1/account/config",
      "GET",
      undefined,
      state.accountId,
    );
    if (latest().accountId !== state.accountId) throw new Error("identity_changed");
    if (server.schema_version !== 1) throw new Error("invalid_config");
    const remote = server.data ? normalizeConfig(server.data) : null;
    const merged = remote ? mergeConfig(configOf(latest()), remote) : configOf(latest());
    if (remote && sameConfig(merged, remote)) return merged;
    const data = configOf({ ...latest(), ...merged });
    if (new TextEncoder().encode(JSON.stringify(data)).length > 65536) throw new Error("config_limit");
    if (latest().accountId !== state.accountId) throw new Error("identity_changed");
    try {
      await api(
        "/v1/account/config",
        "PUT",
        { schema_version: 1, rev: server.rev, data },
        state.accountId,
      );
      if (latest().accountId !== state.accountId) throw new Error("identity_changed");
      return merged;
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 409 || i === 2) throw e;
    }
  }
  throw new Error("conflict");
}
