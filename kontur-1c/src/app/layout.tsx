import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Контур 1С · АЗМЗ Логистика",
  description: "Эмулятор учётного контура 1С для сквозной проверки приложения водителя: справочники, документы, проведение, регистры, план обмена.",
  keywords: ["АЗМЗ Логистика", "Контур 1С", "эмулятор 1С", "приложение водителя", "интеграционный стенд"],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
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
        {/* sonner — тосты рабочих мест (toast.success/error из экранов воркспейса) */}
        <SonnerToaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
