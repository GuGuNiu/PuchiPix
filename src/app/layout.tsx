import type { Metadata } from "next";
import { Dancing_Script } from "next/font/google";
import "./globals.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/pages.css";
import "./styles/ops.css";
import "./styles/responsive.css";
import Sidebar from "@/components/layout/sidebar";
import SocketProvider from "@/components/providers/socket-provider";
import ThemeProvider from "@/components/providers/theme-provider";
import ThemedToaster from "@/components/providers/themed-toaster";
import { I18nProvider } from "@/lib/i18n";

import Script from "next/script";

const dancingScript = Dancing_Script({
  weight: "700",
  subsets: ["latin"],
  variable: "--font-dancing-script",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PuchiPix — M3U8 Video Downloader",
  description: "Browser-automated M3U8 video downloading tool",
};

export const dynamic = "force-dynamic";

const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.JSX.Element {
  return (
    <html lang="zh-CN" className={dancingScript.variable} suppressHydrationWarning>
      <head>
        <link rel="preload" href="/vendor/hls.min.js" as="script" />
      </head>
      <body>
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
        <Script src="/vendor/hls.min.js" strategy="beforeInteractive" />
        <ThemeProvider>
          <I18nProvider>
            <SocketProvider>
              <div className="app-layout">
                <Sidebar />
                <div className="main-area">
                  <main className="content-area">
                    {children}
                  </main>
                </div>
              </div>
            </SocketProvider>
            <ThemedToaster />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
