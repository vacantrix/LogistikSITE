import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./kontur/kontur.css";
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
  title: "АЭМЗ Поток",
  description: "Единая логистическая платформа АЭМЗ: заявки и торги, документы и ЭДО, собственный парк и рейсы в одном контуре.",
  keywords: ["логистика", "АЭМЗ", "Поток", "перевозки", "торги", "1С:ERP", "собственный парк"],
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
    title: "АЭМЗ Поток",
    description: "Единая логистическая платформа АЭМЗ: заявки, документы, собственный парк и рейсы.",
    siteName: "АЭМЗ Поток",
    locale: "ru_RU",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "АЭМЗ Поток",
    description: "Единая логистическая платформа АЭМЗ: заявки, документы, собственный парк и рейсы.",
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
