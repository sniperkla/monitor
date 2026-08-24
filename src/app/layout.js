
import "./globals.css";
import { Rajdhani, Share_Tech_Mono, VT323, JetBrains_Mono } from "next/font/google";

// Self-hosted retro-theme fonts (build-time download — no runtime Google
// Fonts request to fail). Exposed as CSS vars consumed in globals.css.
const rajdhani = Rajdhani({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-retro",
  display: "swap",
});
const shareTechMono = Share_Tech_Mono({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-retro-mono",
  display: "swap",
});
const vt323 = VT323({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-retro-terminal",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains",
  display: "swap",
});
const fontVars = `${rajdhani.variable} ${shareTechMono.variable} ${vt323.variable} ${jetbrainsMono.variable}`;

export const metadata = {
  title: "SSH Monitor — Terminal & Server Management",
  description: "A modern SSH terminal manager with real-time server monitoring, key management, and multi-session support.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SSH Monitor",
  },
};

export const viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

import { Providers } from '@/components/Providers';

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={fontVars}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="icon" type="image/svg+xml" href="/icon.svg" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Share+Tech+Mono&family=VT323&family=Rajdhani:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
