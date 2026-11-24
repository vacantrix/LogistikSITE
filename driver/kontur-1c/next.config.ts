import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // платформа живёт за роутером :3000 под префиксом /kontur (scripts/router.js)
  basePath: "/kontur",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // имитация 1С: без плавающих индикаторов дев-режима поверх «рабочего места»
  devIndicators: false,
};

export default nextConfig;
