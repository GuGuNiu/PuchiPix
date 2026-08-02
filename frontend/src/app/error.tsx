import { useEffect } from "react";
import { AlertTriangle, RotateCw, Home } from "lucide-react";
import { Link } from "react-router-dom";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: ErrorProps): React.JSX.Element {
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
        页面出现异常
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
        应用捕获到未预期的错误。你可以尝试重试当前操作，或返回首页继续使用。
        {isDigest ? (
          <span style={{ display: "block", marginTop: 8, color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
            错误标识：{error.digest}
          </span>
        ) : null}
      </p>
      <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-2)" }}>
        <button onClick={reset} className="btn btn-primary btn-sm">
          <RotateCw size={14} />
          重试
        </button>
        <Link to="/" className="btn btn-outline btn-sm">
          <Home size={14} />
          返回首页
        </Link>
      </div>
    </div>
  );
}
