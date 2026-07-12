/**
 * 模块：路由状态保持
 *
 * 在路由切换时自动保存和恢复页面状态，包括：
 * 1. 滚动位置：返回页面时恢复到上次浏览位置
 * 2. 表单数据：输入框、选择器等未提交的表单状态
 * 3. 页面数据缓存：API 响应数据，避免重新请求
 * 4. 筛选/排序状态：列表的筛选条件和排序方式
 *
 * 实现方式：
 * - 使用 sessionStorage 持久化（关闭标签页自动清除）
 * - 每个路由独立命名空间，互不干扰
 * - 支持 TTL 过期（避免恢复过时数据）
 * - 提供 React Hook useRouteState() 供组件使用
 *
 * @author PuchiPix Team
 * @date 2026-07-09
 * @lastModified 2026-07-09
 */

'use client';

import { useEffect, useCallback, useRef, useState } from 'react';

// ============================================================
// 类型定义
// ============================================================

export interface RouteStateEntry {
  /** 任意可序列化的状态数据 */
  data: Record<string, unknown>;
  /** 滚动位置 */
  scrollTop: number;
  /** 保存时间戳 */
  savedAt: number;
}

export interface RouteStateConfig {
  /** 状态 TTL 毫秒数，过期后不恢复，默认 5 分钟 */
  ttl?: number;
  /** 是否保存滚动位置，默认 true */
  saveScroll?: boolean;
  /** 滚动容器选择器，默认取 .content-area */
  scrollSelector?: string;
}

interface RouteStateStore {
  [routeKey: string]: RouteStateEntry;
}

// ============================================================
// RouteStatePersist 实现
// ============================================================

const STORAGE_KEY = '__puchipix_route_state__';
const DEFAULT_TTL = 5 * 60 * 1000;

class RouteStatePersist {
  private store: RouteStateStore = {};
  private initialized = false;

  /**
   * 初始化 — 从 sessionStorage 加载已保存的状态。
   */
  private ensureInit(): void {
    if (this.initialized) return;
    this.initialized = true;

    if (typeof window === 'undefined') return;

    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.store = JSON.parse(raw);
      }
    } catch {
      // sessionStorage 不可用或数据损坏，忽略
    }

    // 页面卸载时持久化
    window.addEventListener('beforeunload', () => {
      this.flush();
    });
  }

  /**
   * 保存路由状态。
   *
   * @param routeKey - 路由标识（通常为 pathname）
   * @param data - 状态数据
   * @param scrollTop - 滚动位置
   */
  save(routeKey: string, data: Record<string, unknown>, scrollTop: number = 0): void {
    if (typeof window === 'undefined') return;
    this.ensureInit();

    this.store[routeKey] = {
      data,
      scrollTop,
      savedAt: Date.now(),
    };

    // 即时写入 sessionStorage（不等待 beforeunload）
    this.flush();
  }

  /**
   * 读取路由状态。
   *
   * @param routeKey - 路由标识
   * @param ttl - TTL 毫秒数，超过则返回 null
   * @returns 状态条目，或 null（不存在/已过期）
   */
  load(routeKey: string, ttl: number = DEFAULT_TTL): RouteStateEntry | null {
    if (typeof window === 'undefined') return null;
    this.ensureInit();

    const entry = this.store[routeKey];
    if (!entry) return null;

    // 检查 TTL
    if (Date.now() - entry.savedAt > ttl) {
      delete this.store[routeKey];
      return null;
    }

    return entry;
  }

  /**
   * 清除指定路由的状态。
   */
  clear(routeKey: string): void {
    delete this.store[routeKey];
    this.flush();
  }

  /**
   * 清除所有路由状态。
   */
  clearAll(): void {
    this.store = {};
    this.flush();
  }

  /**
   * 持久化到 sessionStorage。
   */
  private flush(): void {
    if (typeof window === 'undefined') return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.store));
    } catch {
      // sessionStorage 满或不可用，忽略
    }
  }
}

// ============================================================
// 单例
// ============================================================

const routeStateInstance = new RouteStatePersist();

export { routeStateInstance as routeState };

// ============================================================
// React Hook：useRouteState
// ============================================================

/**
 * 路由状态保持 Hook。
 *
 * 在组件挂载时自动恢复上次状态，卸载时自动保存当前状态。
 *
 * 使用示例：
 * ```tsx
 * const { savedData, restoreScroll, saveState } = useRouteState('/search', {
 *   ttl: 10 * 60 * 1000,
 *   saveScroll: true,
 * });
 *
 * // 恢复状态
 * useEffect(() => {
 *   if (savedData?.keywords) setKeywords(savedData.keywords as string);
 * }, [savedData]);
 *
 * // 保存状态
 * saveState({ keywords, selectedSiteId });
 * ```
 *
 * @param routeKey - 路由标识（通常使用 usePathname()）
 * @param config - 配置选项
 */
export function useRouteState(
  routeKey: string,
  config: RouteStateConfig = {}
): {
  savedData: Record<string, unknown> | null;
  restoreScroll: () => void;
  saveState: (data: Record<string, unknown>) => void;
} {
  const { ttl = DEFAULT_TTL, saveScroll = true, scrollSelector } = config;
  // 懒初始化：首次渲染即从 sessionStorage 恢复状态
  const [savedData] = useState<Record<string, unknown> | null>(() => {
    const entry = routeStateInstance.load(routeKey, ttl);
    return entry?.data ?? null;
  });
  const scrollRef = useRef<number>(0);

  // 恢复滚动位置（不涉及 setState）
  useEffect(() => {
    if (!saveScroll) return;
    const entry = routeStateInstance.load(routeKey, ttl);
    if (entry && entry.scrollTop > 0) {
      setTimeout(() => {
        const container = scrollSelector
          ? document.querySelector(scrollSelector)
          : document.querySelector('.content-area') || window;
        if (container === window) {
          window.scrollTo(0, entry.scrollTop);
        } else {
          (container as HTMLElement).scrollTop = entry.scrollTop;
        }
      }, 100);
    }
  }, [routeKey, ttl, saveScroll, scrollSelector]);

  // 监听滚动位置
  useEffect(() => {
    if (!saveScroll) return;

    const container = scrollSelector
      ? document.querySelector(scrollSelector)
      : document.querySelector('.content-area');

    if (!container) return;

    const handleScroll = () => {
      scrollRef.current = (container as HTMLElement).scrollTop;
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [saveScroll, scrollSelector]);

  // 卸载时保存滚动位置（保留已保存的数据，不覆盖）
  useEffect(() => {
    return () => {
      if (saveScroll) {
        const container = scrollSelector
          ? document.querySelector(scrollSelector)
          : document.querySelector('.content-area');
        if (container) {
          scrollRef.current = (container as HTMLElement).scrollTop;
        }
      }
      // 只更新滚动位置，保留已有数据
      const existing = routeStateInstance.load(routeKey, ttl);
      routeStateInstance.save(routeKey, existing?.data ?? {}, scrollRef.current);
    };
  }, [routeKey, saveScroll, scrollSelector, ttl]);

  const restoreScroll = useCallback(() => {
    const entry = routeStateInstance.load(routeKey, ttl);
    if (entry && entry.scrollTop > 0) {
      const container = scrollSelector
        ? document.querySelector(scrollSelector)
        : document.querySelector('.content-area') || window;
      if (container === window) {
        window.scrollTo(0, entry.scrollTop);
      } else {
        (container as HTMLElement).scrollTop = entry.scrollTop;
      }
    }
  }, [routeKey, ttl, scrollSelector]);

  const saveState = useCallback(
    (data: Record<string, unknown>) => {
      routeStateInstance.save(routeKey, data, scrollRef.current);
    },
    [routeKey]
  );

  return { savedData, restoreScroll, saveState };
}
