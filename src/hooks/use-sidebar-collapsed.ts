/**
 * hooks/use-sidebar-collapsed.ts — 监听侧边栏折叠状态
 *
 * 通过监听 localStorage 变化和自定义事件，
 * 在 React 组件中实时获取侧边栏的 collapsed 状态。
 *
 * @date 2026-07-13
 */

'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'sidebar-collapsed';
const EVENT_NAME = 'sidebar:collapsed';

const EVENT_HOVER = 'sidebar:hover-expand';

export function useSidebarCollapsed(): boolean {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(STORAGE_KEY) === 'true';
  });

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setCollapsed(e.newValue === 'true');
      }
    };

    const handleCustom = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === 'boolean') {
        setCollapsed(detail);
      }
    };

    const handleHover = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === 'boolean') {
        // hover-expand 为 true 时，侧边栏实际处于展开状态，collapsed 视为 false
        setCollapsed(!detail);
      }
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener(EVENT_NAME, handleCustom);
    window.addEventListener(EVENT_HOVER, handleHover);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(EVENT_NAME, handleCustom);
      window.removeEventListener(EVENT_HOVER, handleHover);
    };
  }, []);

  return collapsed;
}
