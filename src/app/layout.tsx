import type { Metadata } from "next";
import { cookies } from "next/headers";
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
import HlsScriptLoader from "@/components/providers/hls-script-loader";
import { I18nProvider } from "@/lib/i18n";

const dancingScript = Dancing_Script({
  weight: "700",
  subsets: ["latin"],
  variable: "--font-dancing-script",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PuchiPix - Puch Puch ~~",
  description: "Browser-automated M3U8 video downloading tool",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("theme")?.value;
  const themeAttr =
    themeCookie === "dark" || themeCookie === "light" ? themeCookie : undefined;

  return (
    <html
      lang="zh-CN"
      className={dancingScript.variable}
      data-theme={themeAttr}
      suppressHydrationWarning
    >
      <head>
        <link rel="preload" href="/vendor/hls.min.js" as="script" />
      </head>
      <body>
        <HlsScriptLoader />
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
