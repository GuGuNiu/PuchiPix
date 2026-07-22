export function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}): React.JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        background: "var(--bg-inset)",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border)",
      }}
    >
      <div style={{ color, flexShrink: 0 }}>{icon}</div>
      <div>
        <div
          style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: "16px" }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: "var(--text-primary)",
            lineHeight: "22px",
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

export function FilterPill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`pill ${active ? "active" : ""}`}
      onClick={onClick}
      style={{ fontSize: 12, padding: "4px 12px" }}
    >
      {label}
    </button>
  );
}
