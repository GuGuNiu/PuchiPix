import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

const WINDOW_STATE_ENDPOINT = "/api/window/state";

type WindowAction = "minimise" | "toggle" | "close";

const ENDPOINTS: Record<WindowAction, string> = {
  minimise: "/api/window/minimise",
  toggle: "/api/window/toggle-maximise",
  close: "/api/window/close",
};

async function readWindowState(): Promise<boolean | null> {
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
      return (payload as { maximised: boolean }).maximised;
    }
    return null;
  } catch {
    return null;
  }
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
      if (state === null) {
        setAvailable(false);
        return;
      }
      setAvailable(true);
      setMaximised(state);
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

  if (!available) {
    return null;
  }

  return (
    <header
      className="title-bar"
      data-maximised={maximised ? "true" : "false"}
      style={{ "--wails-draggable": "drag" } as React.CSSProperties}
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
