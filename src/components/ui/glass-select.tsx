"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, Check } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export interface GlassSelectOption {
  value: string;
  label: string;
}

interface GlassSelectProps {
  options: GlassSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

export default function GlassSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  style,
  className = "",
}: GlassSelectProps): React.JSX.Element {
  const { t } = useI18n();
  const resolvedPlaceholder = placeholder ?? t("common.selectPlaceholder");
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selectedOption = options.find((o) => o.value === value);

  const closeDropdown = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 180);
  }, []);

  const handleToggle = (): void => {
    if (disabled) return;
    if (open) {
      closeDropdown();
    } else {
      setOpen(true);
    }
  };

  const handleSelect = (val: string): void => {
    onChange(val);
    closeDropdown();
  };

  // 点击外部关闭下拉框
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent): void => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        closeDropdown();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, closeDropdown]);

  // 按 Escape 关闭
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") closeDropdown();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, closeDropdown]);

  return (
    <div
      className={`glass-select ${className}`}
      style={style}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`glass-select-trigger ${open ? "open" : ""}`}
        onClick={handleToggle}
        disabled={disabled}
      >
        <span className="glass-select-trigger-label">
          {selectedOption ? selectedOption.label : resolvedPlaceholder}
        </span>
        <ChevronDown
          size={16}
          className="glass-select-chevron"
        />
      </button>

      {open && (
        <>
          <div className="glass-select-backdrop" onClick={closeDropdown} />
          <div
            className={`glass-select-dropdown ${closing ? "closing" : ""}`}
          >
            {options.map((option) => (
              <div
                key={option.value}
                className={`glass-select-option ${
                  option.value === value ? "selected" : ""
                }`}
                onClick={() => handleSelect(option.value)}
              >
                <span>{option.label}</span>
                {option.value === value && (
                  <Check
                    size={14}
                    className="glass-select-option-check"
                  />
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
