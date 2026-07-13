import type { Metadata } from "next";
import { Dancing_Script } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/layout/sidebar";
import SocketProvider from "@/components/providers/socket-provider";
import ThemeProvider from "@/components/providers/theme-provider";
import ThemedToaster from "@/components/providers/themed-toaster";

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
}>) {
  return (
    <html lang="zh-CN" className={dancingScript.variable}>
      <head>
        <script src="/vendor/hls.min.js" async></script>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ThemeProvider>
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
        </ThemeProvider>
      </body>
    </html>
  );
}
