import type { Metadata } from "next";
import { Dancing_Script } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/layout/sidebar";
import SocketProvider from "@/components/providers/socket-provider";
import { Toaster } from "sonner";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={dancingScript.variable}>
      <head>
        <script src="/vendor/hls.min.js" async></script>
      </head>
      <body>
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
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
