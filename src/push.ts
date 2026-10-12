import { decode64 } from "./encoding.ts";

// A browser push service can hang when its network is blocked. Keep the UI retryable.
export async function pushTimeout<T>(work: Promise<T>, ms = 20000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("pushTimeout")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function subscribePush(reg: ServiceWorkerRegistration, publicKey: string) {
  const key = decode64(publicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    const previous = sub.options.applicationServerKey;
    if (!previous || !new Uint8Array(previous).every((value, i) => value === key[i]) || previous.byteLength !== key.byteLength) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}
