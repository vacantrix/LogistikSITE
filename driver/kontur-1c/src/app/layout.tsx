import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "Контур 1С · АЗМЗ Логистика",
  description: "Эмулятор учётного контура 1С для сквозной проверки приложения водителя: справочники, документы, проведение, регистры, план обмена.",
  keywords: ["АЗМЗ Логистика", "Контур 1С", "эмулятор 1С", "приложение водителя", "интеграционный стенд"],
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
        {/* sonner — тосты рабочих мест (toast.success/error из экранов воркспейса) */}
        <SonnerToaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
