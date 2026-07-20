export default function Loading(): React.JSX.Element {
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
      <span style={{ fontSize: 13, color: "var(--text-muted)" }}>加载中…</span>
    </div>
  );
}
