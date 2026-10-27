import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // сборка падает на ошибках типов (раньше они игнорировались — ignoreBuildErrors)
  reactStrictMode: false,
  // нативные модули не бандлим: генерация DOCX-проформ (Task 99) и работа с изображениями
  serverExternalPackages: ["@resvg/resvg-js", "sharp"],
};

export default nextConfig;
