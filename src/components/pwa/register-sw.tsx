"use client";

import { useEffect } from "react";

/**
 * Регистрация service worker (PWA).
 * В dev-режиме (localhost) тоже регистрируется — чтобы установка «на главный экран»
 * проверялась до выкладки. updateViaCache:'none' — браузер не кэширует сам /sw.js
 * (HTTP-кэш мог держать старую версию и не давать обновиться).
 * Новый SW активировался → одна перезагрузка, чтобы чанки совпали с ним.
 */
export function RegisterSW() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { updateViaCache: "none" })
        .then((reg) => {
          // уже ждущий воркер (обновление пришло, пока страница была открыта)
          if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
        })
        .catch(() => {
          /* SW не критичен: приложение работает и без него */
        });
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    };
    if (document.readyState === "complete") {
      register();
      return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    }
    window.addEventListener("load", register);
    return () => {
      window.removeEventListener("load", register);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);
  return null;
}
