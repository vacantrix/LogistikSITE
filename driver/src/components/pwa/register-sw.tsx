"use client";

import { useEffect } from "react";

/**
 * Регистрация service worker (PWA) модуля водителя.
 * Модуль живёт по /driver/, поэтому и воркер, и его область — под этим префиксом.
 * Обновления подхватываются без ручных действий: при возврате на экран и
 * восстановлении сети проверяем новую версию, а после активации перезагружаем
 * страницу один раз (controllerchange).
 */
export function RegisterSW() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // Место под данные: браузер не должен вычищать кэш рейса при нехватке памяти.
    void navigator.storage?.persist?.().catch(() => undefined);

    let registration: ServiceWorkerRegistration | null = null;
    const refresh = () => {
      if (document.visibilityState === "visible") void registration?.update().catch(() => undefined);
    };
    const onOnline = () => void registration?.update().catch(() => undefined);

    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register("/driver/sw.js", { scope: "/driver" });
        await registration.update().catch(() => undefined);
      } catch {
        /* SW не критичен: приложение работает и без него */
      }
    };

    if (document.readyState === "complete") void register();
    else window.addEventListener("load", register, { once: true });

    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("load", register);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", onOnline);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);
  return null;
}
