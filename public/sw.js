// Push only: no offline cache or interception of API requests.
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  let o; try { o = event.data.json(); } catch { return; }
  if (!o || typeof o !== "object") return;
  const url = o.url === "/#workers" ? "/#workers" : "/#alerts";
  event.waitUntil(self.registration.showNotification(o.title || "Pearl Hub", { body: o.body, tag: o.tag, renotify: !!o.tag, icon: "/icon-192.png?v=pearl-light", data: { url } }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((c) => new URL(c.url).origin === self.location.origin);
    const path = event.notification.data?.url === "/#workers" ? "/#workers" : "/#alerts";
    if (existing) {
      await existing.navigate(new URL(path, self.location.origin).href);
      return existing.focus();
    }
    return self.clients.openWindow(path);
  })());
});
