/* Service worker приложения водителя «АЗМЗ Логистика».
 * Правила:
 *  - API (/api/*) не перехватываем никогда — синхронизация и гео-каналы идут напрямую в сеть;
 *    офлайн-логика приложения живёт в его собственном сторе, SW тут не нужен.
 *  - Навигация: сеть → кэш главной → offline.html.
 *  - Статика (/_next/static, /icons): cache-first.
 */
const VERSION = "azmz-driver-v1";
const PRECACHE = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(PRECACHE).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // внешние ресурсы не трогаем
  if (url.pathname.startsWith("/api/")) return;    // синхронизация — только сеть

  // Навигация: сеть, при обрыве — кэш главной, затем offline-страница
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put("/", copy)).catch(() => undefined);
          return res;
        })
        .catch(() =>
          caches
            .match("/")
            .then((cached) => cached || caches.match("/offline.html"))
            .then((r) => r || new Response("Офлайн", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }))
        )
    );
    return;
  }

  // Статика: cache-first
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req)
          .then((res) => {
            const p = url.pathname;
            if (res.ok && (p.startsWith("/_next/static/") || p.startsWith("/icons/"))) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => undefined);
            }
            return res;
          })
    )
  );
});
