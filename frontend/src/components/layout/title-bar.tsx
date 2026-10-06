import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

const WINDOW_STATE_ENDPOINT = "/api/window/state";

type WindowAction = "minimise" | "toggle" | "close";

interface ChromeWebview {
  postMessage?: (message: string) => void;
}

/**
 * The page is served from the backend origin, so the Wails runtime (which
 * bridges `--wails-draggable` to a native drag) is never injected. The same
 * bridge is one WebView2 host message away: the desktop frontend turns the
 * literal string "drag" into a native move loop, and BindingsAllowedOrigins
 * already admits this origin. No-op in browsers, where chrome.webview is
 * absent.
 */
function startNativeDrag(): void {
  (window as unknown as { chrome?: { webview?: ChromeWebview } }).chrome?.webview?.postMessage?.(
    "drag",
  );
}

const ENDPOINTS: Record<WindowAction, string> = {
  minimise: "/api/window/minimise",
  toggle: "/api/window/toggle-maximise",
  close: "/api/window/close",
};

interface WindowState {
  maximised: boolean;
  cornerRadius: number;
}

async function readWindowState(): Promise<WindowState | null> {
  try {
    const response = await fetch(WINDOW_STATE_ENDPOINT, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    const payload: unknown = await response.json();
    if (
      typeof payload === "object" &&
      payload !== null &&
      "maximised" in payload &&
      typeof (payload as { maximised: unknown }).maximised === "boolean"
    ) {
      const cornerRadius = (payload as { cornerRadius?: unknown }).cornerRadius;
      return {
        maximised: (payload as { maximised: boolean }).maximised,
        cornerRadius: typeof cornerRadius === "number" ? cornerRadius : 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/*
 * The desktop window is a transparent layer; the web shell draws its own
 * rounded corners on top of it. Publishing the shape on <html> lets the base
 * layout clip the app shell without every page knowing about desktop mode.
 * Browser mode (state null) drops both markers and keeps the original look.
 */
function applyShellAppearance(state: WindowState | null): void {
  const root = document.documentElement;
  if (state === null) {
    delete root.dataset.desktopShell;
    root.style.removeProperty("--window-radius");
    return;
  }
  root.dataset.desktopShell = "true";
  const radius = state.maximised ? 0 : state.cornerRadius;
  root.style.setProperty("--window-radius", `${radius}px`);
}

export default function TitleBar(): React.JSX.Element | null {
  const { t } = useI18n();
  const [available, setAvailable] = useState(false);
  const [maximised, setMaximised] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const probe = async (): Promise<void> => {
      const state = await readWindowState();
      if (cancelled) {
        return;
      }
      applyShellAppearance(state);
      if (state === null) {
        setAvailable(false);
        return;
      }
      setAvailable(true);
      setMaximised(state.maximised);
    };

    void probe();
    window.addEventListener("focus", probe);
    window.addEventListener("resize", probe);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", probe);
      window.removeEventListener("resize", probe);
    };
  }, []);

  const run = useCallback((action: WindowAction) => {
    void fetch(ENDPOINTS[action], { method: "POST" }).catch(() => undefined);
  }, []);

  const onToggle = useCallback(() => {
    setMaximised((previous) => !previous);
    run("toggle");
  }, [run]);

  const onMouseDown = useCallback((event: React.MouseEvent<HTMLElement>) => {
    /*
     * Primary button, single click: double-click belongs to the maximise
     * toggle, and the window controls manage their own clicks.
     */
    if (event.button !== 0 || event.detail !== 1) return;
    if ((event.target as HTMLElement).closest(".title-bar-button")) return;
    startNativeDrag();
  }, []);

  if (!available) {
    return null;
  }

  return (
    <header
      className="title-bar"
      data-maximised={maximised ? "true" : "false"}
      style={{ "--wails-draggable": "drag" } as React.CSSProperties}
      onMouseDown={onMouseDown}
      onDoubleClick={onToggle}
    >
      <div className="title-bar-identity">
        <span className="title-bar-name">PuchiPix</span>
      </div>

      <div className="title-bar-actions">
        <button
          type="button"
          className="title-bar-button"
          style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
          onClick={() => run("minimise")}
          aria-label={t("window.minimise")}
          title={t("window.minimise")}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>

        <button
          type="button"
          className="title-bar-button"
          style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
          onClick={onToggle}
          aria-label={maximised ? t("window.restore") : t("window.maximise")}
          title={maximised ? t("window.restore") : t("window.maximise")}
        >
          {maximised ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect
                x="0.5"
                y="0.5"
                width="7"
                height="7"
                fill="none"
                stroke="currentColor"
              />
              <rect
                x="2.5"
                y="2.5"
                width="7"
                height="7"
                fill="var(--title-bar-restore-bg)"
                stroke="currentColor"
              />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect
                x="0.5"
                y="0.5"
                width="9"
                height="9"
                fill="none"
                stroke="currentColor"
              />
            </svg>
          )}
        </button>

        <button
          type="button"
          className="title-bar-button title-bar-button-danger"
          style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
          onClick={() => run("close")}
          aria-label={t("window.close")}
          title={t("window.close")}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d="M0 0.5 L10 9.5 M10 0.5 L0 9.5"
              stroke="currentColor"
              strokeWidth="1"
              fill="none"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}
