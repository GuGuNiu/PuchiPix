import { Component, Suspense, lazy, useEffect, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "@/components/layout/sidebar";
import ThemeProvider from "@/components/providers/theme-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { ThemedToaster } from "@/components/providers";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { initSharedSse, destroySharedSse } from "@/lib/sse/shared-sse";
import { initSiteModules } from "@/lib/site-modules";
import GlobalError from "./pages/error";

const Dashboard = lazy(() => import("./pages/index"));
const TasksPage = lazy(() => import("./pages/tasks/index"));
const SearchPage = lazy(() => import("./pages/search"));
const ShelfPhotos = lazy(() => import("./pages/shelf/photos/index"));
const ShelfVideos = lazy(() => import("./pages/shelf/videos/index"));
const ShelfSJS = lazy(() => import("./pages/shelf/sjs"));
const SniffPage = lazy(() => import("./pages/sniff"));
const ConfigPage = lazy(() => import("./pages/config"));
const ConfigGames = lazy(() => import("./pages/config/games"));
const BlocklistPage = lazy(() => import("./pages/blocklist"));
const ProtagonistsList = lazy(() => import("./pages/protagonists/index"));
const ProtagonistDetail = lazy(() => import("./pages/protagonists/detail"));
const ModelStagePage = lazy(() => import("./pages/modelstage"));

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
                        <Route path="/shelf" element={<Navigate to="/shelf/photos" replace />} />
                        <Route path="/shelf/photos" element={<ShelfPhotos />} />
                        <Route path="/shelf/videos" element={<ShelfVideos />} />
                        <Route path="/shelf/sjs" element={<ShelfSJS />} />
                        <Route path="/sniff" element={<SniffPage />} />
                        <Route path="/config" element={<ConfigPage />} />
                        <Route path="/config/games" element={<ConfigGames />} />
                        <Route path="/blocklist" element={<BlocklistPage />} />
                        <Route path="/protagonists" element={<ProtagonistsList />} />
                        <Route path="/protagonists/:name" element={<ProtagonistDetail />} />
                        <Route path="/modelstage" element={<ModelStagePage />} />
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

const NotFound = lazy(() => import("./pages/not-found"));
