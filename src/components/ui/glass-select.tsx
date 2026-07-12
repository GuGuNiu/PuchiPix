"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, Check } from "lucide-react";

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
  placeholder = "请选择",
  disabled = false,
  style,
  className = "",
}: GlassSelectProps) {
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

  const handleToggle = () => {
    if (disabled) return;
    if (open) {
      closeDropdown();
    } else {
      setOpen(true);
    }
  };

  const handleSelect = (val: string) => {
    onChange(val);
    closeDropdown();
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
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

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
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
          {selectedOption ? selectedOption.label : placeholder}
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
