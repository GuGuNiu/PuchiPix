import { Link } from "react-router-dom";
import { Home, Compass } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export default function NotFound(): React.JSX.Element {
  const { t } = useI18n();
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
      <Compass size={48} style={{ color: "var(--accent)" }} />
      <h1
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: "var(--text-primary)",
          margin: 0,
          letterSpacing: "-0.6px",
        }}
      >
        404
      </h1>
      <p
        style={{
          fontSize: 13,
          color: "var(--text-secondary)",
          maxWidth: 420,
          margin: 0,
          lineHeight: 1.6,
        }}
      >
        {t("error.notFoundTitle")}。{t("error.notFoundDesc")}
      </p>
      <Link to="/" className="btn btn-primary btn-sm">
        <Home size={14} />
        {t("common.backHome")}
      </Link>
    </div>
  );
}
