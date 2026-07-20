import Link from "next/link";
import { Home, Compass } from "lucide-react";

export default function NotFound(): React.JSX.Element {
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
        未找到对应的页面。它可能已被移动、删除，或从未存在。
      </p>
      <Link href="/" className="btn btn-primary btn-sm">
        <Home size={14} />
        返回首页
      </Link>
    </div>
  );
}
