import { Component, Suspense, lazy, useEffect, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "@/components/layout/sidebar";
import ThemeProvider from "@/components/providers/theme-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { ThemedToaster } from "@/components/providers";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { initSharedSse, destroySharedSse } from "@/lib/sse/shared-sse";
import { initSiteModules } from "@/lib/sites/site-modules";
import GlobalError from "./pages/error";

/* Lazy-loaded route components. */
const Dashboard = lazy(() => import("./pages/index"));
const TasksPage = lazy(() => import("./pages/tasks/index"));
const SearchPage = lazy(() => import("./pages/search/index"));
const ShelfPhotos = lazy(() => import("./pages/shelf/photos/index"));
const ShelfSJS = lazy(() => import("./pages/shelf/sjs/index"));
const SniffPage = lazy(() => import("./pages/sniff/index"));
const ConfigPage = lazy(() => import("./pages/config/index"));
const ConfigGames = lazy(() => import("./pages/config/games/index"));
const BlocklistPage = lazy(() => import("./pages/blocklist/index"));
const ProtagonistsList = lazy(() => import("./pages/protagonists/index"));
const ProtagonistDetail = lazy(() => import("./pages/protagonists/detail/index"));
const ModelStagePage = lazy(() => import("./pages/modelstage/index"));

/** Global loading fallback for lazy routes. */
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
 * Route-level error boundary. On lazy-chunk load failure or page render
 * exceptions, GlobalError is shown instead of a blank screen.
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
    initSiteModules();
    return () => {
      destroySharedSse();
    };
  }, []);

  return (
    <BrowserRouter>
      <ThemeProvider>
        <QueryProvider>
          <I18nProvider>
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
                        {/* /shelf redirects to /shelf/photos */}
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
                        {/* Custom 404 page */}
                        <Route path="*" element={<NotFound />} />
                      </Routes>
                    </Suspense>
                  </RouteErrorBoundary>
                </main>
              </div>
            </div>
            <ThemedToaster />
          </I18nProvider>
        </QueryProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

/** Lazy-loaded 404 page. */
const NotFound = lazy(() => import("./pages/not-found"));
