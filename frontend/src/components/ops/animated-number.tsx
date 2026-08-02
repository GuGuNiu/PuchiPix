import { useEffect, useRef, useState } from "react";


interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  duration?: number;
}

export function AnimatedNumber({ value, decimals = 0, duration = 600 }: AnimatedNumberProps): React.JSX.Element {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const start = prevRef.current;
    const diff = value - start;
    if (diff === 0) return;

    const startTime = performance.now();

    const tick = (now: number): void => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = start + diff * eased;
      setDisplay(current);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        prevRef.current = value;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
     
  }, [value, duration]);

  const formatted = decimals > 0
    ? display.toFixed(decimals)
    : Math.round(display).toString();

  return <span style={{ display: "inline-block" }}>{formatted}</span>;
}


type IconProps = { size?: number; strokeWidth?: number };

export function AnimatedCounter({ value, label, icon: Icon, color, unit }: {
  value: number;
  label: string;
  icon: React.ComponentType<IconProps>;
  color?: string;
  unit?: string;
}): React.JSX.Element {
  return (
    <div className={`ops-kpi-col ${color ?? "blue"}`} style={{ position: "relative" }}>
      <div className="ops-kpi-icon">
        <Icon size={18} strokeWidth={2} />
      </div>
      <div className="ops-kpi-body">
        <div className="ops-kpi-value">
          <AnimatedNumber value={value} />
          {unit && <span className="ops-kpi-unit">{unit}</span>}
        </div>
        <div className="ops-kpi-label">{label}</div>
      </div>
    </div>
  );
}
