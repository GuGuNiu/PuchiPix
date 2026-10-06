import type { LucideIcon } from "lucide-react";

export interface TaskSettings {
  maxConcurrentTasks: number;
  maxConcurrentSniffTasks: number;
  maxScrapingTasks: number;
  tsSegmentConcurrent: number;
  galleryImageConcurrent: number;
}

export interface TaskSettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

const inputStyle: React.CSSProperties = {
  width: 60,
  textAlign: "center",
  padding: "6px 8px",
  fontSize: 16,
  fontWeight: 600,
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text-primary)",
  outline: "none",
  flexShrink: 0,
};

const btnStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  padding: 0,
  justifyContent: "center",
  flexShrink: 0,
};

export function NumberStepper({
  value,
  min,
  max,
  unit,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
}): React.JSX.Element {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <button
        className="btn btn-outline btn-sm"
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        style={btnStyle}
      >
        −
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 1)}
        style={inputStyle}
      />
      <button
        className="btn btn-outline btn-sm"
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        style={btnStyle}
      >
        +
      </button>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{unit}</span>
    </div>
  );
}

export function SettingCard({
  icon: Icon,
  iconColor,
  label,
  description,
  children,
  marginBottom = 20,
}: {
  icon: LucideIcon;
  iconColor: string;
  label: string;
  description: string;
  children: React.ReactNode;
  marginBottom?: number;
}): React.JSX.Element {
  return (
    <div
      style={{
        marginBottom,
        padding: 16,
        background: "var(--bg-inset)",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border-light)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <Icon size={15} style={{ color: iconColor }} />
        <label
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--text-primary)",
          }}
        >
          {label}
        </label>
      </div>
      <p
        style={{
          fontSize: 12,
          color: "var(--text-muted)",
          margin: "0 0 12px 0",
          lineHeight: 1.5,
        }}
      >
        {description}
      </p>
      {children}
    </div>
  );
}
