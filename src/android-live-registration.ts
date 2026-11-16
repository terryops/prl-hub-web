export type LiveRegistrationState = { token: string; retiring: string[] };
type Ports = {
  token(): Promise<string>;
  hash(token: string): Promise<string>;
  put(key: string, token: string, startedAt: number): Promise<void>;
  remove(key: string): Promise<void>;
  persist(state: LiveRegistrationState): void;
  sleep(ms: number): Promise<void>;
};

/** Serializes Worker mutations: a stop must delete after an already-started PUT finishes. */
export class LiveRegistration {
  pending = false;
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  private token: string;
  private retiring: Set<string>;
  private readonly ports: Ports;

  constructor(state: LiveRegistrationState, ports: Ports) {
    this.ports = ports;
    this.token = state.token;
    this.retiring = new Set(state.retiring);
    this.retiring.delete(this.token);
  }

  get needsCleanup(): boolean { return !!this.token || this.retiring.size > 0; }
  defer(): void { this.pending = true; }
  invalidate(): void { this.generation++; }

  async register(startedAt: number, suppliedToken?: string): Promise<void> {
    const run = ++this.generation;
    this.pending = true;
    let reg: string, key: string;
    try {
      reg = suppliedToken || await this.ports.token();
      if (run !== this.generation) return;
      key = await this.ports.hash(reg);
    } catch { return; }
    if (run !== this.generation) return;

    // One immediate attempt, then the four 5/10/20/40-second retries.
    for (let attempt = 0; attempt <= 4 && run === this.generation; attempt++) {
      try {
        await this.enqueue(async () => {
          if (run !== this.generation) return;
          if (this.token && this.token !== key) this.retiring.add(this.token);
          this.retiring.delete(key);
          this.token = key;
          // Remember before PUT: even a failed response can mean the server accepted it.
          this.persist();
          await this.cleanRetired();
          if (run !== this.generation) return;
          await this.ports.put(key, reg, startedAt);
        });
        if (run === this.generation) this.pending = this.retiring.size > 0;
        return;
      } catch {
        if (attempt < 4 && run === this.generation) await this.ports.sleep(5000 * 2 ** attempt);
      }
    }
  }

  async unregister(): Promise<void> {
    this.generation++;
    this.pending = false;
    await this.enqueue(async () => {
      if (this.token) {
        this.retiring.add(this.token);
        this.token = "";
        this.persist();
      }
      await this.cleanRetired();
    });
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => {});
    return next;
  }

  private async cleanRetired(): Promise<void> {
    for (const key of this.retiring) {
      try { await this.ports.remove(key); } catch { continue; }
      this.retiring.delete(key);
      this.persist();
    }
  }

  private persist(): void {
    this.ports.persist({ token: this.token, retiring: [...this.retiring] });
  }
}
