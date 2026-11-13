/* Service worker приложения водителя «АЗМЗ Логистика» — v7.
 *
 * Правила:
 *  1. Тайлы офлайн-карты /api/maptiles/*: сначала кэш пака «azmz-map-pack-v1»
 *     (имя НЕ содержит версию — пак переживает релизы), затем сеть. Офлайн и
 *     нет в паке → 504, MapLibre покажет пустую плитку, приложение живёт.
 *     Манифест пака /api/maptiles/__pack-manifest — ТОЛЬКО из кэша.
 *  2. Прочий /api/* (синхронизация, заявки 1С, пробки) — только сеть, не трогаем.
 *  3. Навигация: сеть → кэш главной → offline.html.
 *  4. Статика (/_next/static, /icons, воркер MapLibre): NETWORK-FIRST — иначе
 *     закэшированные навсегда чанки не дают обновиться приложению (урок v5).
 */

const VERSION = "azmz-driver-v7";
const MAP_PACK = "azmz-map-pack-v1";
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

/** Тайл базовой карты? /api/maptiles/osm|esri|2gis/{z}/{x}/{y}.png */
function isMapTile(pathname) {
  return /^\/api\/maptiles\/(osm|esri|2gis)\/\d+\/\d+\/\d+\.png$/.test(pathname);
}

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
      // пак карты (MAP_PACK) переживает релизы — удаляем только старые версии SW
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== VERSION && k !== MAP_PACK).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // внешние ресурсы не трогаем

  // ── тайлы офлайн-карты: пак → сеть ─────────────────────────────────────
  if (isMapTile(url.pathname)) {
    event.respondWith(
      caches.open(MAP_PACK).then((cache) =>
        cache.match(req).then(
          (hit) =>
            hit ||
            fetch(req).catch(
              () => new Response("", { status: 504, statusText: "tile offline" })
            )
        )
      )
    );
    return;
  }

  // ── манифест пака: только кэш (офлайн-состояние без сети) ───────────────
  if (url.pathname === "/api/maptiles/__pack-manifest") {
    event.respondWith(
      caches
        .open(MAP_PACK)
        .then((cache) => cache.match(req))
        .then(
          (hit) =>
            hit ||
            new Response(JSON.stringify({ tileCount: 0, bytes: 0, builtAt: 0 }), {
              headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
            })
        )
    );
    return;
  }

  // ── прочий API — только сеть (офлайн-логика живёт в сторе приложения) ──
  if (url.pathname.startsWith("/api/")) return;

  // ── навигация: сеть → кэш главной → offline-страница ────────────────────
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
            .then(
              (r) =>
                r ||
                new Response("Офлайн", {
                  status: 503,
                  headers: { "Content-Type": "text/plain; charset=utf-8" },
                })
            )
        )
    );
    return;
  }

  // ── статика и прочее: network-first → кэш ───────────────────────────────
  // (кэшируем только то, что безопасно: чанки, иконки, воркер, стили)
  event.respondWith(
    fetch(req)
      .then((res) => {
        const p = url.pathname;
        if (
          res.ok &&
          (p.startsWith("/_next/static/") ||
            p.startsWith("/icons/") ||
            p === "/maplibre-gl-worker.mjs" ||
            p === "/manifest.webmanifest" ||
            p === "/offline.html")
        ) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => undefined);
        }
        return res;
      })
      .catch(() => Promise.resolve(caches.match(req)).then((cached) => cached || undefined))
      .then((res) => res || new Response("", { status: 504 }))
  );
});
