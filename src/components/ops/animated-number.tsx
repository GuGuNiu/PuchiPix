"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 数字滚动动画组件
 *
 * 数字变化时平滑过渡到目标值，监控面板风格的数字显示。
 *
 * @param value - 目标数值
 * @param decimals - 小数位数
 * @param duration - 动画持续时间 (ms)
 */
interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  duration?: number;
}

export function AnimatedNumber({ value, decimals = 0, duration = 600 }: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const start = prevRef.current;
    const diff = value - start;
    if (diff === 0) return;

    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  const formatted = decimals > 0
    ? display.toFixed(decimals)
    : Math.round(display).toString();

  return <span style={{ display: "inline-block" }}>{formatted}</span>;
}

/**
 * 数字滚动入场动画包装器
 *
 * 结合卡片入场动画，先淡入再开始数字滚动。
 */
type IconProps = { size?: number; strokeWidth?: number };

export function AnimatedCounter({ value, label, icon: Icon, color, unit }: {
  value: number;
  label: string;
  icon: React.ComponentType<IconProps>;
  color?: string;
  unit?: string;
}) {
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
