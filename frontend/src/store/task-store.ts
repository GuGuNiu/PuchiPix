import { create } from 'zustand';
import type { DownloadTask } from '@/types';

interface TaskStore {
  tasks: DownloadTask[];
  loading: boolean;
  sseConnected: boolean;
  sniffTaskEventId: number;
  lastSniffTaskEvent: SniffTaskEventData | null;
  fetchTasks: (status?: string) => Promise<void>;
  addTask: (task: DownloadTask) => void;
  removeTask: (id: number, taskType?: string) => void;
  clearDeletedKey: (id: number, taskType: string) => void;
  connectSSE: () => () => void;
  subscribeToSocket: () => () => void;
}

export interface SniffTaskEventData {
  action: 'galleryCreated';
  sniffId: number;
  galleryId?: number;
  seq?: string | null;
  title?: string;
  totalCreated?: number;
  totalSkipped?: number;
}

function taskKey(t: DownloadTask): string {
  return `${t.TaskType || 'video'}-${t.ID}`;
}

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
    try {
      // Fetch both video download tasks and gallery tasks
      const [tasksRes, shelfRes] = await Promise.all([
        fetch(status ? `/api/tasks?status=${status}` : '/api/tasks'),
        fetch('/api/shelf?limit=500'),
      ]);

      const videoData = await tasksRes.json();
      const shelfData = await shelfRes.json();
      const videoTasks = Array.isArray(videoData) ? videoData : [];

      // Map gallery shelf items to DownloadTask format
      const galleryTasks: DownloadTask[] = Array.isArray(shelfData)
        ? shelfData.map((g: any) => ({
            ID: g.id,
            URL: g.sourceUrl || '',
            M3U8URL: '',
            Status: g.status || 'pending',
            Progress: 0,
            FilePath: g.savePath || '',
            Format: '',
            Priority: 0,
            ErrorMsg: g.errorMsg || '',
            CreatedAt: g.createdAt || '',
            UpdatedAt: g.updatedAt || '',
            TaskType: 'gallery' as const,
            GalleryTitle: g.title || '',
            ImageCount: g.imageCount ?? 0,
            VideoCount: g.videoCount ?? 0,
            DownloadMethod: g.downloadMethod || '',
            GalleryTotalSize: g.totalSize ?? 0,
            Person: g.protagonist || '',
          }))
        : [];

      const allTasks = [...videoTasks, ...galleryTasks];
      const serverTaskKeys = new Set(allTasks.map(taskKey));
      for (const key of deletedKeys) {
        if (serverTaskKeys.has(key)) {
          deletedKeys.delete(key);
        }
      }
      const filtered = allTasks.filter((t) => !deletedKeys.has(taskKey(t)));
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
          set((s) => {
            if (filtered.length === 0 && s.tasks.length > 0) {
              return { loading: false };
            }
            return { tasks: filtered, loading: false };
          });
        } catch (err) {
          console.warn('[TaskStore] SSE initial parse failed:', err instanceof Error ? err.message : String(err));
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
        } catch (err) {
          console.warn('[TaskStore] SSE upsert parse failed:', err instanceof Error ? err.message : String(err));
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
        } catch (err) {
          console.warn('[TaskStore] SSE patch parse failed:', err instanceof Error ? err.message : String(err));
        }
      });

      eventSource.addEventListener('delete', (e: MessageEvent) => {
        try {
          const { id, taskType } = JSON.parse(e.data) as {
            id: number;
            taskType: string;
          };
          const key = `${taskType}-${id}`;
          deletedKeys.delete(key);
          set((s) => ({
            tasks: s.tasks.filter((t) => taskKey(t) !== key),
          }));
        } catch (err) {
          console.warn('[TaskStore] SSE delete parse failed:', err instanceof Error ? err.message : String(err));
        }
      });

      eventSource.addEventListener('sniffTask', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as SniffTaskEventData;
          set((s) => ({
            sniffTaskEventId: s.sniffTaskEventId + 1,
            lastSniffTaskEvent: data,
          }));
        } catch (err) {
          console.warn('[TaskStore] SSE sniffTask parse failed:', err instanceof Error ? err.message : String(err));
        }
      });

      eventSource.addEventListener('notification', (e: MessageEvent) => {
        try {
          const { type, message, id } = JSON.parse(e.data) as {
            type: 'info' | 'success' | 'warning' | 'error';
            message: string;
            id?: string;
          };
          import('@/lib/i18n/toast').then(({ toast }) => {
            switch (type) {
              case 'info':
                toast.info(message, { id });
                break;
              case 'success':
                toast.success(message, { id });
                break;
              case 'warning':
                toast.warning(message, { id });
                break;
              case 'error':
                toast.error(message, { id });
                break;
            }
          });
        } catch (err) {
          console.warn('[TaskStore] SSE notification parse failed:', err instanceof Error ? err.message : String(err));
        }
      });

      eventSource.addEventListener('nodeProgress', (e: MessageEvent) => {
        try {
          const { dagId, current, total, failed } = JSON.parse(e.data) as {
            dagId: string;
            nodeId: string;
            phase: string;
            current: number;
            total: number;
            speed?: string;
            failed?: number;
          };
          const galleryId = dagId.startsWith('gallery-')
            ? parseInt(dagId.replace('gallery-', ''), 10)
            : NaN;
          if (isNaN(galleryId)) return;
          const key = `gallery-${galleryId}`;
          const progress = total > 0 ? Math.min((current / total) * 100, 99) : 0;
          set((s) => ({
            tasks: s.tasks.map((t) =>
              taskKey(t) === key
                ? {
                  ...t,
                  Progress: progress,
                  GalleryProgressInfo: {
                    completed: current,
                    total,
                    failed: failed ?? 0,
                  },
                }
                : t,
            ),
          }));
        } catch (err) {
          console.warn('[TaskStore] SSE nodeProgress parse failed:', err instanceof Error ? err.message : String(err));
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
