import { create } from "zustand";

export type Theme = "light" | "dark";
export type Locale = "zh-CN" | "zh-TW" | "en-US" | "ja-JP" | "ko-KR" | "ru-RU" | "de-DE" | "vi-VN" | "es-ES" | "pt-BR" | "fr-FR" | "id-ID";

export interface UserPreferences {
  theme: Theme;
  locale: Locale;
  sidebarCollapsed: boolean;
}

interface PreferenceStore extends UserPreferences {
  loaded: boolean;
  setTheme: (theme: Theme) => void;
  setLocale: (locale: Locale) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  loadFromServer: () => Promise<void>;
  saveToServer: (partial: Partial<UserPreferences>) => Promise<void>;
}

const PREF_KEYS: Record<keyof UserPreferences, string> = {
  theme: "ui_theme",
  locale: "ui_locale",
  sidebarCollapsed: "ui_sidebar_collapsed",
};

const VALID_LOCALES: Locale[] = [
  "zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR",
  "ru-RU", "de-DE", "vi-VN", "es-ES", "pt-BR", "fr-FR", "id-ID",
];

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  document.cookie = `theme=${theme}; path=/; max-age=31536000; samesite=lax`;
}

function applyLocale(locale: Locale): void {
  document.documentElement.lang = locale;
}


function readThemeFromCookie(): Theme {
  if (typeof document === "undefined") return "light";
  const match = document.cookie.match(/(?:^|;\s*)theme=(light|dark)/);
  return (match?.[1] as Theme) ?? "light";
}


function readLocaleFromDoc(): Locale {
  if (typeof document === "undefined") return "zh-CN";
  const lang = document.documentElement.lang as Locale;
  return VALID_LOCALES.includes(lang) ? lang : "zh-CN";
}

export const usePreferenceStore = create<PreferenceStore>()((set, get) => ({
  theme: readThemeFromCookie(),
  locale: readLocaleFromDoc(),
  sidebarCollapsed: false,
  loaded: false,

  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme);
    get().saveToServer({ theme });
  },

  setLocale: (locale) => {
    set({ locale });
    applyLocale(locale);
    get().saveToServer({ locale });
  },

  setSidebarCollapsed: (sidebarCollapsed) => {
    set({ sidebarCollapsed });
    get().saveToServer({ sidebarCollapsed });
  },

  loadFromServer: async () => {
    try {
      const res = await fetch("/api/preferences");
      if (!res.ok) throw new Error("Failed to load preferences");
      const data = (await res.json()) as Record<string, string>;

      const next: Partial<PreferenceStore> = {};
      const themeValue = data[PREF_KEYS.theme];
      if (themeValue === "light" || themeValue === "dark") {
        next.theme = themeValue;
      }
      if (VALID_LOCALES.includes(data[PREF_KEYS.locale] as Locale)) {
        next.locale = data[PREF_KEYS.locale] as Locale;
      }
      if (data[PREF_KEYS.sidebarCollapsed] === "true" || data[PREF_KEYS.sidebarCollapsed] === "false") {
        next.sidebarCollapsed = data[PREF_KEYS.sidebarCollapsed] === "true";
      }

      set({ ...next, loaded: true });

      if (next.theme) applyTheme(next.theme);
      if (next.locale) applyLocale(next.locale);
    } catch {
      set({ loaded: true });
    }
  },

  saveToServer: async (partial) => {
    const payload: Record<string, { value: string; category: string }> = {};
    for (const [k, v] of Object.entries(partial)) {
      const key = PREF_KEYS[k as keyof UserPreferences];
      if (!key) continue;
      payload[key] = { value: String(v), category: "ui" };
    }
    if (Object.keys(payload).length === 0) return;

    try {
      await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.warn('[PreferenceStore] Save failed:', err instanceof Error ? err.message : String(err));
    }
  },
}));
