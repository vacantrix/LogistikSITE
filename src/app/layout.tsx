import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "АЭМЗ Логистика",
  description: "Закрытая площадка для агентов-перевозчиков: торги по заявкам, документы, проверка нейросетью, единый реестр рейсов в 1С:ERP.",
  keywords: ["логистика", "АЭМЗ", "перевозки", "торги", "1С:ERP", "платформа"],
  authors: [{ name: "ООО «АЭМЗ»" }],
  // знак LogistikSITE: SVG для современных браузеров, ICO/PNG — для старых и закладок
  icons: {
    icon: [
      { url: "/logo-mark.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
    ],
    apple: "/apple-touch-icon.png",
  },
  // превью ссылки в мессенджерах и почте
  openGraph: {
    title: "АЭМЗ Логистика",
    description: "Закрытая площадка АЭМЗ для перевозчиков: торги по заявкам, документы и реестр рейсов.",
    siteName: "АЭМЗ Логистика",
    locale: "ru_RU",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "АЭМЗ Логистика",
    description: "Закрытая площадка АЭМЗ для перевозчиков: торги по заявкам, документы и реестр рейсов.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
