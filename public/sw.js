/* Service worker модуля водителя «АЭМЗ Поток».
 * Модуль смонтирован в /driver (basePath), поэтому область — /driver,
 * а все внутренние пути считаются от неё. Правила:
 *  - API (/api/*) не перехватываем никогда — синхронизация и гео-каналы идут напрямую в сеть;
 *    офлайн-логика приложения живёт в его собственном сторе, SW тут не нужен.
 *  - Навигация: сеть → кэш приложения → offline.html.
 *  - Статика (/driver/_next/static, /driver/icons): cache-first.
 */
const VERSION = "aemz-driver-v7";
const BASE = new URL(".", self.location).pathname;      // "/driver/"
const APP = BASE.replace(/\/+$/, "");                    // "/driver"
const PRECACHE = [
  APP,
  BASE + "offline.html",
  BASE + "manifest.webmanifest",
  BASE + "icons/icon-192.png",
  BASE + "icons/icon-512.png",
  BASE + "icons/icon-maskable-192.png",
  BASE + "icons/icon-maskable-512.png",
  BASE + "icons/apple-touch-icon.png",
  BASE + "icons/favicon.ico",
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

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") void self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // внешние ресурсы не трогаем
  if (url.pathname.startsWith("/api/")) return;    // синхронизация — только сеть

  // Навигация: сеть, при обрыве — кэш приложения, затем offline-страница
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(APP, copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(() =>
          caches
            .match(APP)
            .then((cached) => cached || caches.match(BASE + "offline.html"))
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
            if (res.ok && (p.includes("/_next/static/") || p.startsWith(BASE + "icons/"))) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => undefined);
            }
            return res;
          })
    )
  );
});
