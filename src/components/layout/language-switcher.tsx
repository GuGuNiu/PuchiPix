"use client";

/**
 * 语言切换器组件
 *
 * 在侧边栏底部显示当前语言，点击展开语言选择菜单。
 * 支持简体中文、繁体中文、美式英文、日文。
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Languages, Check, ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { LOCALES } from "@/lib/i18n/types";
import type { Locale } from "@/lib/i18n/types";

export default function LanguageSwitcher(): React.JSX.Element {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, handleClickOutside]);

  const currentLocale = LOCALES.find((l) => l.code === locale);

  const handleSelect = (code: Locale): void => {
    setLocale(code);
    setOpen(false);
  };

  return (
    <div className="lang-switcher" ref={containerRef}>
      <button
        className="lang-switcher-btn"
        onClick={() => setOpen(!open)}
        title={t("nav.language")}
        aria-label={t("nav.language")}
      >
        <span className="lang-switcher-icon-wrap">
          <Languages size={18} strokeWidth={2} />
        </span>
        <span className="lang-switcher-label">
          {currentLocale?.shortLabel ?? locale}
        </span>
        <ChevronDown
          size={14}
          strokeWidth={2}
          className={`lang-switcher-chevron ${open ? "open" : ""}`}
        />
      </button>

      {open && (
        <div className="lang-switcher-menu">
          {LOCALES.map((l) => (
            <button
              key={l.code}
              className={`lang-switcher-item ${locale === l.code ? "active" : ""}`}
              onClick={() => handleSelect(l.code)}
            >
              <span className="lang-switcher-flag">{l.flag}</span>
              <span className="lang-switcher-item-label">{l.label}</span>
              {locale === l.code && (
                <Check size={14} strokeWidth={2.5} className="lang-switcher-check" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
