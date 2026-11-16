type Identity = { accountId: string; purchaseId: string; token: string };
type Context<S> = { state: S; account: number; generation: number };
type Ports<S, T, R> = {
  current(): Context<S>;
  saving(): void;
  key(target: T): Promise<string>;
  attempted(state: S, token: string): void;
  put(state: S, target: T): Promise<R>;
  saved(state: S, result: R): void;
  failed(error: unknown): void;
  remove(state: S): Promise<void>;
  removed(): Promise<void>;
};

/** Keeps device-setting writes and withdrawal ordered across native prompts and account changes. */
export class PushSettings<S extends Identity, T, R> {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly ports: Ports<S, T, R>;
  constructor(ports: Ports<S, T, R>) { this.ports = ports; }

  register(state: S, prepare: () => Promise<T>): Promise<boolean> {
    const expected = { ...state };
    const current = this.guard(expected);
    return this.enqueue(async () => {
      if (!current()) return false;
      this.ports.saving();
      try {
        const target = await prepare();
        if (!current()) return false;
        const token = await this.ports.key(target);
        if (!current()) return false;
        // A response failure can still mean PUT was accepted. Remember the exact key before
        // sending, so a stop/reload can withdraw even a newly rotated registration.
        expected.token = token;
        this.ports.attempted(state, token);
        const result = await this.ports.put(state, target);
        if (!current()) return false;
        this.ports.saved(state, result);
        return true;
      } catch (error) {
        if (!current()) return false;
        this.ports.failed(error);
        throw error;
      }
    });
  }

  withdraw(state: S): Promise<boolean> {
    const current = this.guard(state);
    return this.enqueue(async () => {
      if (!current()) return false;
      await this.ports.remove(state);
      if (!current()) return false;
      await this.ports.removed();
      return true;
    });
  }

  private guard(state: S): () => boolean {
    const { account, generation } = this.ports.current();
    return () => {
      const now = this.ports.current();
      return now.account === account && now.generation === generation &&
        (now.state.accountId || now.state.purchaseId) === (state.accountId || state.purchaseId) &&
        now.state.token === state.token;
    };
  }

  private enqueue<R2>(work: () => Promise<R2>): Promise<R2> {
    const next = this.tail.catch(() => {}).then(work);
    this.tail = next;
    return next;
  }
}

export async function pushTargetKey(target: { fcm: { token: string } } | { subscription: { endpoint?: string } }): Promise<string> {
  const value = "fcm" in target ? `fcm:${target.fcm.token}` : target.subscription.endpoint;
  if (!value) throw new Error("pushConnectError");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}
