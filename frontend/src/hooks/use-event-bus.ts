'use client';

import { useEffect, useState } from 'react';
import { useSocketStore } from '@/store/socket-store';

export interface UseEventBusReturn<T = unknown> {
  lastEvent: T | null;
  /** EventCount */
  count: number;
}

/**
 * Subscribe EventBus Event React Hook。
 *
 *
 * @param eventName - Eventname
 * @returns Latest event data
 */
export function useEventBus<T = unknown>(eventName: string): UseEventBusReturn<T> {
  const { socket } = useSocketStore();
  const [lastEvent, setLastEvent] = useState<T | null>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!socket) return;

    const handler = (payload: T): void => {
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
