import { useEffect } from "react";
import { AlertTriangle, RotateCw, Home } from "lucide-react";
import { Link } from "react-router-dom";
import { useI18n } from "@/lib/i18n";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: ErrorProps): React.JSX.Element {
  const { t } = useI18n();

  useEffect(() => {
    console.error("[RouteError]", error);
  }, [error]);

  const isDigest = Boolean(error.digest);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        gap: "var(--space-4)",
        padding: "var(--space-8)",
        textAlign: "center",
      }}
    >
      <AlertTriangle size={48} style={{ color: "var(--danger)" }} />
      <h1
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: "var(--text-primary)",
          margin: 0,
        }}
      >
        {t("error.pageError")}
      </h1>
      <p
        style={{
          fontSize: 13,
          color: "var(--text-secondary)",
          maxWidth: 480,
          margin: 0,
          lineHeight: 1.6,
        }}
      >
        {t("error.pageErrorDesc")}
        {isDigest ? (
          <span style={{ display: "block", marginTop: 8, color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
            {t("error.digest")}{error.digest}
          </span>
        ) : null}
      </p>
      <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-2)" }}>
        <button onClick={reset} className="btn btn-primary btn-sm">
          <RotateCw size={14} />
          {t("common.retry")}
        </button>
        <Link to="/" className="btn btn-outline btn-sm">
          <Home size={14} />
          {t("common.backHome")}
        </Link>
      </div>
    </div>
  );
}
