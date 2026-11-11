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
};

export default nextConfig;
