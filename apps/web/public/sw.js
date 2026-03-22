/* eslint-disable no-restricted-globals */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const options = {
      body: data.message || "",
      icon: "/icon.png",
      badge: "/icon.png",
      data: { link: data.link },
    };
    event.waitUntil(self.registration.showNotification(data.title || "Atrium", options));
  } catch {
    // Ignore malformed payloads
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const link = event.notification.data?.link;
  const url = link ? new URL(link, self.location.origin).href : self.location.origin;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Focus existing tab if possible
      for (const client of clientList) {
        if (client.url === url && "focus" in client) {
          return client.focus();
        }
      }
      // Otherwise open a new tab
      return self.clients.openWindow(url);
    }),
  );
});
