import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /**
   * Модуль водителя живёт внутри «АЭМЗ Поток» по адресу /driver/.
   * basePath даёт собственные /driver/_next/*, /driver/manifest.webmanifest,
   * /driver/sw.js и /driver/api/*, поэтому PWA не конфликтует с платформой
   * на том же домене. Снаружи API остаётся корневым (/api/driver/v1/*):
   * шлюз добавляет /driver при проксировании, адреса APK не меняются.
   */
  basePath: "/driver",
  /**
   * sw.js лежит в /driver/sw.js, но должен управлять и корнем /driver
   * (без завершающего слэша). По умолчанию область ограничена /driver/,
   * поэтому явно разрешаем /driver: иначе офлайн-оболочка не перехватывает
   * навигацию на главный экран PWA.
   */
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [{ key: "Service-Worker-Allowed", value: "/driver" }],
      },
    ];
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
