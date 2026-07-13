/**
 * 任务状态管理 Store（HTTP 初始加载 + SSE 实时增量更新）
 *
 * 数据流：
 * 1. fetchTasks() — HTTP GET /api/tasks 获取全量列表（快速初始加载）
 * 2. connectSSE() — EventSource 订阅实时增量：
 *    - upsert：完整任务对象（创建、爬取完成等）
 *    - patch：部分字段更新（进度等高频事件，300ms 节流）
 *    - delete：任务删除通知
 *
 * @date 2026-07-12
 * @lastModified 2026-07-13
 */

import { create } from 'zustand';
import type { DownloadTask } from '@/types';

interface TaskStore {
  tasks: DownloadTask[];
  loading: boolean;
  sseConnected: boolean;
  fetchTasks: (status?: string) => Promise<void>;
  addTask: (task: DownloadTask) => void;
  removeTask: (id: number, taskType?: string) => void;
  connectSSE: () => () => void;
  subscribeToSocket: () => () => void;
}

function taskKey(t: DownloadTask): string {
  return `${t.TaskType || 'video'}-${t.ID}`;
}

const deletedKeys = new Set<string>();

function markDeleted(key: string) {
  deletedKeys.add(key);
  setTimeout(() => deletedKeys.delete(key), 5000);
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  loading: true,
  sseConnected: false,

  fetchTasks: async (status?: string) => {
    set({ loading: true });
    try {
      const url = status ? `/api/tasks?status=${status}` : '/api/tasks';
      const res = await fetch(url);
      const data = await res.json();
      set({ tasks: Array.isArray(data) ? data : [], loading: false });
    } catch {
      set({ loading: false });
    }
  },

  addTask: (task) => set((s) => {
    const key = taskKey(task);
    const exists = s.tasks.some((t) => taskKey(t) === key);
    if (exists) return s;
    return { tasks: [task, ...s.tasks] };
  }),

  removeTask: (id, taskType?: string) =>
    set((s) => {
      if (taskType) {
        const key = `${taskType}-${id}`;
        markDeleted(key);
        return { tasks: s.tasks.filter((t) => taskKey(t) !== key) };
      }
      markDeleted(`video-${id}`);
      markDeleted(`gallery-${id}`);
      return { tasks: s.tasks.filter((t) => t.ID !== id) };
    }),

  connectSSE: () => {
    let eventSource: EventSource | null = null;

    const connect = () => {
      eventSource = new EventSource('/api/tasks/stream');

      eventSource.onopen = () => {
        set({ sseConnected: true });
      };

      eventSource.onerror = () => {
        set({ sseConnected: false });
      };

      eventSource.addEventListener('initial', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as DownloadTask[];
          const filtered = data.filter((t) => !deletedKeys.has(taskKey(t)));
          // 空数组不覆盖已有 HTTP 数据，避免 SSE 先发送空 initial 时清空列表
          // 有数据时总是更新，并结束 loading
          set((s) => {
            if (filtered.length === 0 && s.tasks.length > 0) {
              return { loading: false };
            }
            return { tasks: filtered, loading: false };
          });
        } catch {
          // ignore parse error
        }
      });

      eventSource.addEventListener('upsert', (e: MessageEvent) => {
        try {
          const task = JSON.parse(e.data) as DownloadTask;
          const key = taskKey(task);
          if (deletedKeys.has(key)) return;
          set((s) => {
            const idx = s.tasks.findIndex((t) => taskKey(t) === key);
            if (idx >= 0) {
              const newTasks = [...s.tasks];
              newTasks[idx] = task;
              return { tasks: newTasks };
            }
            return { tasks: [task, ...s.tasks] };
          });
        } catch {
          // ignore
        }
      });

      eventSource.addEventListener('patch', (e: MessageEvent) => {
        try {
          const { id, taskType, changes } = JSON.parse(e.data) as {
            id: number;
            taskType: string;
            changes: Partial<DownloadTask>;
          };
          const key = `${taskType}-${id}`;
          set((s) => ({
            tasks: s.tasks.map((t) =>
              taskKey(t) === key ? { ...t, ...changes } : t,
            ),
          }));
        } catch {
          // ignore
        }
      });

      eventSource.addEventListener('delete', (e: MessageEvent) => {
        try {
          const { id, taskType } = JSON.parse(e.data) as {
            id: number;
            taskType: string;
          };
          const key = `${taskType}-${id}`;
          set((s) => ({
            tasks: s.tasks.filter((t) => taskKey(t) !== key),
          }));
        } catch {
          // ignore
        }
      });
    };

    connect();

    return () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      set({ sseConnected: false });
    };
  },

  subscribeToSocket: () => {
    return get().connectSSE();
  },
}));
