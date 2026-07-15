import { create } from 'zustand';
import type { DownloadTask } from '@/types';

interface TaskStore {
  tasks: DownloadTask[];
  loading: boolean;
  sseConnected: boolean;
  sniffTaskEventId: number;
  /** 最新的嗅探任务事件数据 */
  lastSniffTaskEvent: SniffTaskEventData | null;
  fetchTasks: (status?: string) => Promise<void>;
  addTask: (task: DownloadTask) => void;
  removeTask: (id: number, taskType?: string) => void;
  /** 清除指定任务的删除标记（DELETE 请求失败时恢复任务） */
  clearDeletedKey: (id: number, taskType: string) => void;
  connectSSE: () => () => void;
  subscribeToSocket: () => () => void;
}

export interface SniffTaskEventData {
  action: 'galleryCreated';
  sniffId: number;
  galleryId?: number;
  seq?: number;
  title?: string;
  totalCreated?: number;
  totalSkipped?: number;
}

function taskKey(t: DownloadTask): string {
  return `${t.TaskType || 'video'}-${t.ID}`;
}

/**
 * 已删除任务的 key 集合
 *
 * 用于防止 SSE 事件将已删除的任务重新加入列表。
 * 不再使用定时器自动过期 —— 改为事件驱动清理：
 * - 服务端确认删除（SSE delete 事件）时清除对应 key
 * - DELETE 请求失败时通过 clearDeletedKey 清除
 * - fetchTasks 重新拉取数据时全部清除
 */
const deletedKeys = new Set<string>();

function markDeleted(key: string): void {
  deletedKeys.add(key);
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  loading: true,
  sseConnected: false,
  sniffTaskEventId: 0,
  lastSniffTaskEvent: null,

  fetchTasks: async (status?: string) => {
    set({ loading: true });
    // 在 fetch 前清除删除标记，使 SSE 事件在 fetch 期间不被阻塞。
    // fetch 期间如果有新的删除操作，markDeleted 会重新添加标记，
    // 最终在下面通过 filter 过滤掉。
    deletedKeys.clear();
    try {
      const url = status ? `/api/tasks?status=${status}` : '/api/tasks';
      const res = await fetch(url);
      const data = await res.json();
      const tasks = Array.isArray(data) ? data : [];
      // fetch 期间可能有新的删除操作，过滤掉已标记删除的任务
      const filtered = tasks.filter((t) => !deletedKeys.has(taskKey(t)));
      set({ tasks: filtered, loading: false });
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
      markDeleted(`sniff-${id}`);
      return { tasks: s.tasks.filter((t) => t.ID !== id) };
    }),

  clearDeletedKey: (id: number, taskType: string) => {
    deletedKeys.delete(`${taskType}-${id}`);
  },

  connectSSE: () => {
    let eventSource: EventSource | null = null;

    const connect = (): void => {
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
        }
      });

      eventSource.addEventListener('delete', (e: MessageEvent) => {
        try {
          const { id, taskType } = JSON.parse(e.data) as {
            id: number;
            taskType: string;
          };
          const key = `${taskType}-${id}`;
          // 服务端确认删除，清除删除标记（不再需要防止 SSE 重新加入）
          deletedKeys.delete(key);
          set((s) => ({
            tasks: s.tasks.filter((t) => taskKey(t) !== key),
          }));
        } catch {
        }
      });

      eventSource.addEventListener('sniffTask', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as SniffTaskEventData;
          set((s) => ({
            sniffTaskEventId: s.sniffTaskEventId + 1,
            lastSniffTaskEvent: data,
          }));
        } catch {
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
