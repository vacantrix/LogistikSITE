import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // сборка падает на ошибках типов (раньше они игнорировались — ignoreBuildErrors)
  reactStrictMode: false,
};

export default nextConfig;
