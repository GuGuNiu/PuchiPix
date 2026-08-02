import { Component, Suspense, lazy, useEffect, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "@/components/layout/sidebar";
import SocketProvider from "@/components/providers/socket-provider";
import ThemeProvider from "@/components/providers/theme-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { ThemedToaster } from "@/components/providers";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { initSharedSse, destroySharedSse } from "@/lib/sse/shared-sse";
import GlobalError from "./app/error";

/*
 * Lazy-loaded page components — replaces Next.js file-system routing.
 * Each import maps directly to the original app/ directory structure.
 */
const Dashboard = lazy(() => import("./app/page"));
const TasksPage = lazy(() => import("./app/tasks/page"));
const SearchPage = lazy(() => import("./app/search/page"));
const ShelfPhotos = lazy(() => import("./app/shelf/photos/page"));
const ShelfSJS = lazy(() => import("./app/shelf/sjs/page"));
const SniffPage = lazy(() => import("./app/sniff/page"));
const ConfigPage = lazy(() => import("./app/config/page"));
const ConfigGames = lazy(() => import("./app/config/games/page"));
const BlocklistPage = lazy(() => import("./app/blocklist/page"));
const ProtagonistsList = lazy(() => import("./app/protagonists/page"));
const ProtagonistDetail = lazy(() => import("./app/protagonists/[name]/page"));
const ModelStagePage = lazy(() => import("./app/modelstage/page"));

/** Global loading fallback for lazy routes — mirrors loading.tsx */
function RouteLoading(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "50vh",
        gap: "var(--space-4)",
      }}
    >
      <div className="loading-spinner" />
      <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("common.loading")}</span>
    </div>
  );
}

/**
 * Route-level error boundary — mirrors Next.js error.tsx.
 * On lazy-chunk load failure or page render exceptions, GlobalError is
 * shown instead of a blank screen.
 */
interface RouteErrorBoundaryProps {
  children: ReactNode;
}

interface RouteErrorBoundaryState {
  error: Error | null;
}

class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  handleReset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <GlobalError
          error={this.state.error}
          reset={this.handleReset}
        />
      );
    }
    return this.props.children;
  }
}

export default function App(): React.JSX.Element {
  /*
   * App-wide shared SSE connection: it stays resident for the whole
   * app lifetime, so route switching only subscribes/unsubscribes
   * instead of repeatedly disconnecting and reconnecting.
   */
  useEffect(() => {
    initSharedSse();
    return () => {
      destroySharedSse();
    };
  }, []);

  return (
    <BrowserRouter>
      <ThemeProvider>
        <QueryProvider>
          <I18nProvider>
            <SocketProvider>
              <div className="app-layout">
                <Sidebar />
                <div className="main-area">
                  <main className="content-area">
                    <RouteErrorBoundary>
                      <Suspense fallback={<RouteLoading />}>
                        <Routes>
                          <Route path="/" element={<Dashboard />} />
                          <Route path="/tasks" element={<TasksPage />} />
                          <Route path="/search" element={<SearchPage />} />
                          {/* /shelf redirects to /shelf/photos (was server-side redirect()) */}
                          <Route path="/shelf" element={<Navigate to="/shelf/photos" replace />} />
                          <Route path="/shelf/photos" element={<ShelfPhotos />} />
                          <Route path="/shelf/sjs" element={<ShelfSJS />} />
                          <Route path="/sniff" element={<SniffPage />} />
                          <Route path="/config" element={<ConfigPage />} />
                          <Route path="/config/games" element={<ConfigGames />} />
                          <Route path="/blocklist" element={<BlocklistPage />} />
                          <Route path="/protagonists" element={<ProtagonistsList />} />
                          <Route path="/protagonists/:name" element={<ProtagonistDetail />} />
                          <Route path="/modelstage" element={<ModelStagePage />} />
                          {/* Custom 404 — replaces not-found.tsx */}
                          <Route path="*" element={<NotFound />} />
                        </Routes>
                      </Suspense>
                    </RouteErrorBoundary>
                  </main>
                </div>
              </div>
            </SocketProvider>
            <ThemedToaster />
          </I18nProvider>
        </QueryProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

/** Lazy-loaded 404 page — mirrors not-found.tsx */
const NotFound = lazy(() => import("./app/not-found"));
