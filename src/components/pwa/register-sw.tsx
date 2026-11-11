"use client";

import { useEffect } from "react";

/**
 * Регистрация service worker (PWA).
 * В dev-режиме (localhost) тоже регистрируется — чтобы установка «на главный экран»
 * проверялась до выкладки. API-запросы SW не перехватывает (см. public/sw.js).
 */
export function RegisterSW() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* SW не критичен: приложение работает и без него */
      });
    };
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);
  return null;
}
