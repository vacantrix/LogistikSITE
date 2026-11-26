import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // превью-панель песочницы и локальные заходы ходят на не-localhost хосты:
  // без этого Next 16 блокирует cross-origin dev-ресурсы (HMR, шрифты)
  allowedDevOrigins: ["127.0.0.1", "*.space-z.ai"],
  experimental: {
    // политика агентских обновлений Next.js: security-патчи ставятся автоматически
    agentUpgrade: "security",
  },
  // сборка падает на ошибках типов (раньше они игнорировались — ignoreBuildErrors)
  reactStrictMode: false,
  // нативные модули не бандлим: генерация DOCX-проформ (Task 99) и работа с изображениями
  serverExternalPackages: ["@resvg/resvg-js", "sharp"],
  // Диспетчерская использует отдельный сгенерированный Prisma-клиент со своим
  // движком SQLite. Явно включаем его файлы в standalone-сборку, иначе
  // query_engine-*.node не попадает в .next/standalone.
  outputFileTracingIncludes: {
    "/**/*": ["./src/generated/kontur-client/**/*"],
  },
};

export default nextConfig;
