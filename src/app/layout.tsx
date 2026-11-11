import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { RegisterSW } from "@/components/pwa/register-sw";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "АЗМЗ Логистика — приложение водителя",
  description:
    "Сборка приложения водителя из каркаса АЗМЗ: карта, рейс, пометки, офис. Офлайн-первый, outbox-синхронизация, MapLibre (без Yandex API).",
  applicationName: "АЗМЗ Логистика",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "АЗМЗ Логистика",
  },
  icons: {
    icon: [
      { url: "/icons/favicon.ico", sizes: "48x48", type: "image/x-icon" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
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
        className={`${inter.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
        <RegisterSW />
      </body>
    </html>
  );
}
