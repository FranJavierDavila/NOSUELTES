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
  title: "NO SUELTES - Prototipo ragdoll",
  description:
    "Prototipo 3D de control fisico de un personaje ragdoll: mueve, fija y estabiliza extremidades para resolver una pared de escalada. TypeScript + Babylon.js, contenido data-driven.",
  keywords: ["NO SUELTES", "prototipo", "ragdoll", "fisica", "Babylon.js", "escalada", "videojuego"],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "NO SUELTES - Prototipo ragdoll",
    description: "Control fisico de un personaje ragdoll en una pared de escalada",
    siteName: "NO SUELTES",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
