import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { RegisterSW } from "@/components/pwa/register-sw";

export const metadata: Metadata = {
  title: "АЭМЗ Поток — приложение водителя",
  description:
    "Модуль водителя платформы «АЭМЗ Поток»: карта, рейс, пометки, офис. Офлайн-первый, outbox-синхронизация, MapLibre (без Yandex API).",
  applicationName: "АЭМЗ Поток",
  manifest: "/driver/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "АЭМЗ Поток",
  },
  icons: {
    icon: [
      { url: "/driver/icons/favicon.ico", sizes: "48x48", type: "image/x-icon" },
      { url: "/driver/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/driver/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/driver/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  userScalable: false,
  themeColor: "#101E2E",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className="antialiased bg-background text-foreground"
      >
        {children}
        <Toaster />
        <RegisterSW />
      </body>
    </html>
  );
}
