import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // имитация 1С: без плавающих индикаторов дев-режима поверх «рабочего места»
  devIndicators: false,
  // Платформа живёт в подпапке репозитория drivemobile (рядом приложение
  // водителя со СВОИМ node_modules и ДРУГОЙ схемой Prisma). Без этих опций
  // Next/Turbopack считает корнем весь репозиторий (по lock-файлам) и
  // резолвит @prisma/client из корневого node_modules — клиент чужой схемы.
  turbopack: {
    root: path.join(__dirname),
  },
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
