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
  title: "CARRY ME",
  description:
    "Cooperativo de escalada para 2 jugadores: dos sherpas ragdoll suben al Everest cargando con un ricachón colgado de la cuerda. TypeScript + Babylon.js, contenido data-driven.",
  keywords: ["CARRY ME", "SHERPAS AL LÍMITE", "cooperativo", "ragdoll", "fisica", "Babylon.js", "escalada", "videojuego", "Everest"],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "CARRY ME",
    description: "Two sherpas, a rich man on his plank, and Everest",
    siteName: "CARRY ME",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
