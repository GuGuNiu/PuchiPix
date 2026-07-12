/**
 * hooks/use-event-bus.ts — 前端 EventBus 订阅 Hook
 *
 * 通过 Socket.IO 接收服务端 EventBus 广播的事件，
 * 在 React 组件中以声明式方式订阅。
 *
 * 使用示例：
 * ```tsx
 * const { lastEvent, count } = useEventBus('task:completed');
 * ```
 *
 * @date 2026-07-09
 * @lastModified 2026-07-09
 */

'use client';

import { useEffect, useState } from 'react';
import { useSocketStore } from '@/store/socket-store';

export interface UseEventBusReturn<T = unknown> {
  /** 最近一条事件载荷 */
  lastEvent: T | null;
  /** 事件计数（用于触发依赖更新） */
  count: number;
}

/**
 * 订阅 EventBus 事件的 React Hook。
 *
 * 自动在组件挂载时订阅 Socket.IO 事件，
 * 卸载时自动取消订阅。
 *
 * @param eventName - 事件名称（如 'task:progress'）
 * @returns 最近事件数据
 */
export function useEventBus<T = unknown>(eventName: string): UseEventBusReturn<T> {
  const { socket } = useSocketStore();
  const [lastEvent, setLastEvent] = useState<T | null>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!socket) return;

    const handler = (payload: T) => {
      setLastEvent(payload);
      setCount((c) => c + 1);
    };

    socket.on(eventName, handler);

    return () => {
      socket.off(eventName, handler);
    };
  }, [socket, eventName]);

  return {
    lastEvent,
    count,
  };
}
