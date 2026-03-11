
import "./globals.css";

export const metadata = {
  title: "SSH Monitor — Terminal & Server Management",
  description: "A modern SSH terminal manager with real-time server monitoring, key management, and multi-session support.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Webtop OS",
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
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Share+Tech+Mono&family=VT323&display=swap"
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
