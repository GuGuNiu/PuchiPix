import { useEffect, useState, useCallback } from 'react';
import { usePreferenceStore } from '@/store/preference-store';

const EVENT_NAME = 'sidebar:collapsed';
const EVENT_HOVER = 'sidebar:hover-expand';

export function useSidebarCollapsed(): boolean {
  const collapsed = usePreferenceStore((s) => s.sidebarCollapsed);
  const setCollapsed = usePreferenceStore((s) => s.setSidebarCollapsed);
  const [hoverExpand, setHoverExpand] = useState(false);

  useEffect(() => {
    const handleCustom = (e: Event): void => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === 'boolean') {
        setCollapsed(detail);
      }
    };

    const handleHover = (e: Event): void => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === 'boolean') {
        setHoverExpand(detail);
      }
    };

    window.addEventListener(EVENT_NAME, handleCustom);
    window.addEventListener(EVENT_HOVER, handleHover);

    return () => {
      window.removeEventListener(EVENT_NAME, handleCustom);
      window.removeEventListener(EVENT_HOVER, handleHover);
    };
  }, [setCollapsed]);

  return hoverExpand ? false : collapsed;
}

export function useSidebarToggle(): {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (v: boolean) => void;
} {
  const collapsed = usePreferenceStore((s) => s.sidebarCollapsed);
  const setCollapsed = usePreferenceStore((s) => s.setSidebarCollapsed);

  const toggle = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);
    window.dispatchEvent(new CustomEvent('sidebar:collapsed', { detail: next }));
  }, [collapsed, setCollapsed]);

  return { collapsed, toggle, setCollapsed };
}
