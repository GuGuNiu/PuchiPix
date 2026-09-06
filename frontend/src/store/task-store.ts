import { create } from 'zustand';
import type { DownloadTask, TaskStatus } from '@/types';
import { subscribeSseEvent, onSseConnectionState } from '@/lib/sse/shared-sse';
import { createLogger } from '@/lib/core/infra';
import { normalizeStringArray } from '@/pages/tasks/_lib/task-helpers';

const logger = createLogger('TaskStore');

interface TaskStore {
  tasks: DownloadTask[];
  loading: boolean;
  sseConnected: boolean;
  totalCount: number;
  currentPage: number;
  hasMore: boolean;
  loadingMore: boolean;
  fetchTasks: (status?: string) => Promise<void>;
  loadMoreTasks: () => Promise<void>;
  addTask: (task: DownloadTask) => void;
  updateTask: (id: number, taskType: string, patch: Partial<DownloadTask>) => void;
  removeTask: (id: number, taskType?: string) => void;
  clearDeletedKey: (id: number, taskType: string) => void;
  connectSSE: () => () => void;
  subscribeToSocket: () => () => void;
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
  totalCount: 0,
  currentPage: 0,
  hasMore: false,
  loadingMore: false,

  fetchTasks: async (status?: string) => {
    set({ loading: true });
    try {
      const res = await fetch(status ? `/api/tasks/all?status=${status}` : '/api/tasks/all');
      const data = await res.json();
      // Handle both old format (array) and new format (paginated object)
      const rawTasks: DownloadTask[] = Array.isArray(data) ? data : (data.tasks || []);
      const totalCount = Array.isArray(data) ? rawTasks.length : (data.totalCount || rawTasks.length);
      // If response is bare array (legacy format) but SSE has already delivered
      // paginated metadata, do NOT downgrade hasMore to false.
      const incomingHasMore = Array.isArray(data) ? false : (data.hasMore || false);
      const filtered = rawTasks.filter((t: DownloadTask) => !deletedKeys.has(taskKey(t)));
      // Full fetch = DB is the single source of truth. Clear stale deletion
      // marks so permanently-resident keys cannot block future SSE events.
      // (Regression restore of the 260715 fix, lost in the Go-era rewrite:
      // batch delete left keys in deletedKeys forever.)
      deletedKeys.clear();
      set((s) => {
        if (filtered.length === 0 && s.tasks.length > 0) {
          return { loading: false, totalCount, hasMore: s.hasMore || incomingHasMore };
        }
        // Race-condition guard: if SSE initial already set hasMore=true,
        // an array-format fetchTasks response must NOT reset it to false.
        return {
          tasks: filtered,
          loading: false,
          totalCount,
          hasMore: s.hasMore || incomingHasMore,
          currentPage: 1,
        };
      });
    } catch {
      set({ loading: false });
    }
  },

  loadMoreTasks: async () => {
    const { loadingMore, hasMore, tasks } = get();
    if (loadingMore || !hasMore) return;

    set({ loadingMore: true });
    try {
      const nextPage = get().currentPage + 1;
      const res = await fetch(`/api/tasks/page?page=${nextPage}&pageSize=100`);
      const data = await res.json();
      const newTasks = (data.tasks || []) as DownloadTask[];
      const existingKeys = new Set(tasks.map(taskKey));
      const uniqueNewTasks = newTasks.filter((t) => !existingKeys.has(taskKey(t)) && !deletedKeys.has(taskKey(t)));
      set((s) => ({
        tasks: [...s.tasks, ...uniqueNewTasks],
        currentPage: nextPage,
        totalCount: data.totalCount ?? s.totalCount,
        hasMore: data.hasMore ?? false,
        loadingMore: false,
      }));
    } catch {
      set({ loadingMore: false });
    }
  },

  addTask: (task) => set((s) => {
    const key = taskKey(task);
    const exists = s.tasks.some((t) => taskKey(t) === key);
    if (exists) return s;
    return { tasks: [task, ...s.tasks] };
  }),

  updateTask: (id, taskType, patch) => set((s) => {
    const key = `${taskType}-${id}`;
    return {
      tasks: s.tasks.map((t) =>
        taskKey(t) === key ? { ...t, ...patch } : t,
      ),
    };
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
    const unsubs: Array<() => void> = [];

    unsubs.push(
      onSseConnectionState((connState) => {
        set({ sseConnected: connState === 'connected' });
      }),
    );

    unsubs.push(
      subscribeSseEvent('initial', (e: MessageEvent) => {
        try {
          const raw = JSON.parse(e.data);
          // Handle both old format (array) and new paginated format (object)
          let data: DownloadTask[];
          let totalCount = 0;
          let hasMore = false;
          if (Array.isArray(raw)) {
            data = raw as DownloadTask[];
          } else {
            data = (raw.tasks || []) as DownloadTask[];
            totalCount = raw.totalCount || data.length;
            hasMore = raw.hasMore || false;
          }
          const filtered = data.filter((t) => !deletedKeys.has(taskKey(t)));
          set((s) => {
            if (filtered.length === 0 && s.tasks.length > 0) {
              return { loading: false, totalCount, hasMore };
            }
            return {
              tasks: filtered,
              loading: false,
              totalCount,
              hasMore,
              currentPage: 1,
            };
          });
        } catch (err) {
          logger.warn('SSE initial parse failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );

    unsubs.push(
      subscribeSseEvent('task:created', (e: MessageEvent) => {
        try {
          const raw = JSON.parse(e.data) as Partial<DownloadTask> & { TaskType?: string };
          const taskType = raw.TaskType || 'video';
          if (taskType === 'gallery') return;
          const task = { ...raw, TaskType: taskType } as DownloadTask;
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
          logger.warn('SSE task:created parse failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );

    unsubs.push(
      subscribeSseEvent('gallery:created', (e: MessageEvent) => {
        try {
          const raw = JSON.parse(e.data) as {
            ID: number;
            SourceURL?: string;
            DisplayID?: string;
            Status?: string;
            CreatedAt?: string;
            UpdatedAt?: string;
          };
          const key = `gallery-${raw.ID}`;
          if (deletedKeys.has(key)) return;
          set((s) => {
            if (s.tasks.some((t) => taskKey(t) === key)) return s;
            const task: DownloadTask = {
              ID: raw.ID,
              DisplayID: raw.DisplayID,
              URL: raw.SourceURL || '',
              M3U8URL: '',
              Status: (raw.Status as TaskStatus) || 'pending',
              Progress: 0,
              FilePath: '',
              Format: '',
              Priority: 0,
              ErrorMsg: '',
              CreatedAt: raw.CreatedAt || '',
              UpdatedAt: raw.UpdatedAt || '',
              TaskType: 'gallery',
              GalleryTitle: '',
              ImageCount: 0,
              VideoCount: 0,
              DownloadMethod: '',
              GalleryTotalSize: 0,
              Person: '',
            };
            return { tasks: [task, ...s.tasks] };
          });
        } catch (err) {
          logger.warn('SSE gallery:created parse failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );

    unsubs.push(
      subscribeSseEvent('task:progress', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data) as {
            taskId: number;
            taskType?: string;
            progress?: number;
            status?: string;
            speed?: string;
            completed?: number;
            total?: number;
            failed?: number;
            segment?: number;
            downloadedSize?: number;
            downloadedBytes?: number;
          };
          const taskType = payload.taskType || 'video';
          const key = `${taskType}-${payload.taskId}`;
          // Terminal states that should not be overwritten by
          // non-terminal SSE events (prevents stale task:progress
          // events from reverting a completed/partial/failed task
          // back to "downloading").
          const TERMINAL_STATES: TaskStatus[] = ['completed', 'partial', 'failed', 'cancelled'];
          set((s) => ({
            tasks: s.tasks.map((t) => {
              if (taskKey(t) !== key) return t;
              // Terminal state guard: if the task is already in a
              // terminal state and this event does not carry a
              // terminal status, skip the update entirely.
              const incomingStatus = payload.status === 'scraped' ? 'download_pending' : payload.status as TaskStatus;
              if (TERMINAL_STATES.includes(t.Status) && incomingStatus && !TERMINAL_STATES.includes(incomingStatus)) {
                return t;
              }
              const next = {
                ...t,
                // Progress non-regression: use Math.max so a stale
                // event with a lower progress value cannot overwrite
                // a higher value already displayed.
                // EXCEPTION 1 — new download round (retry): when the
                // segment index moves BACKWARDS (e.g. 458 → 1), the
                // task has been re-submitted and progress legitimately
                // restarts from ~0; Math.max would pin the display at
                // the previous round's 100% forever.
                // EXCEPTION 2 — transcoding phase progress: while
                // status is "transcoding", the progress field carries
                // the transcode percentage (0→100), which legitimately
                // restarts from 0 after the download's 100%.
                Progress: payload.progress !== undefined
                  ? (payload.status === 'transcoding'
                      ? payload.progress
                      : payload.segment !== undefined &&
                         typeof t.Segment === 'number' &&
                         payload.segment < t.Segment
                          ? payload.progress
                          : Math.max(t.Progress, payload.progress))
                  : t.Progress,
                Status: incomingStatus || t.Status,
              };
              if (taskType === 'video' && payload.segment !== undefined && payload.total !== undefined && payload.total > 0) {
                next.Segment = payload.segment;
                next.TotalSegments = payload.total;
              }
              if (taskType === 'video' && payload.downloadedBytes !== undefined && payload.downloadedBytes > 0) {
                next.DownloadedBytes = payload.downloadedBytes;
              }
              if (payload.completed !== undefined && payload.total !== undefined && payload.total > 0) {
                next.GalleryProgressInfo = {
                  completed: payload.completed,
                  total: payload.total,
                  failed: payload.failed ?? 0,
                };
              }
              if (taskType === 'gallery' && payload.downloadedSize !== undefined && payload.downloadedSize > 0) {
                next.DownloadedSize = payload.downloadedSize;
              }
              return next;
            }),
          }));
        } catch (err) {
          logger.warn('SSE task:progress parse failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );

    unsubs.push(
      subscribeSseEvent('task:completed', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data) as {
            taskId: number;
            taskType?: string;
            status?: string;
            progress?: number;
          };
          const taskType = payload.taskType || 'video';
          const key = `${taskType}-${payload.taskId}`;
          const status = (payload.status || 'completed') as TaskStatus;
          set((s) => ({
            tasks: s.tasks.map((t) =>
              taskKey(t) === key
                ? {
                    ...t,
                    Status: status,
                    // Use the progress value from the completed event
                    // if present (backend now includes it), otherwise
                    // default to 100 for completed, or keep current
                    // for partial/other terminal states.
                    Progress: payload.progress !== undefined
                      ? Math.max(t.Progress, payload.progress)
                      : status === 'completed' ? 100 : t.Progress,
                  }
                : t,
            ),
          }));
        } catch (err) {
          logger.warn('SSE task:completed parse failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );

    unsubs.push(
      subscribeSseEvent('task:failed', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data) as { taskId: number; error?: string };
          set((s) => ({
            tasks: s.tasks.map((t) =>
              taskKey(t) === `video-${payload.taskId}`
                ? { ...t, Status: 'failed' as TaskStatus, ErrorMsg: payload.error || t.ErrorMsg }
                : t,
            ),
          }));
        } catch (err) {
          logger.warn('SSE task:failed parse failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );

    unsubs.push(
      subscribeSseEvent('task:cancelled', (e: MessageEvent) => {
        try {
          const raw = JSON.parse(e.data) as { taskId: number; taskType?: string };
          const taskId = raw.taskId;
          const taskType = raw.taskType || 'video';
          const key = `${taskType}-${taskId}`;
          markDeleted(key);
          set((s) => ({
            tasks: s.tasks.filter((t) => taskKey(t) !== key),
          }));
        } catch (err) {
          logger.warn('SSE task:cancelled parse failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );

    unsubs.push(
      subscribeSseEvent('dag:nodeProgress', (e: MessageEvent) => {
        try {
          const { dagId, galleryId, current, total, failed } = JSON.parse(e.data) as {
            dagId: string;
            nodeId: string;
            phase: string;
            current: number;
            total: number;
            speed?: string;
            failed?: number;
            galleryId?: number;
            taskId?: number;
            sniffId?: number;
          };
          let gallery = galleryId ?? NaN;
          if (isNaN(gallery) && dagId.startsWith('gallery-')) {
            gallery = parseInt(dagId.replace('gallery-', ''), 10);
          }
          if (isNaN(gallery)) return;
          const key = `gallery-${gallery}`;
          const progress = total > 0 ? Math.min((current / total) * 100, 99) : 0;
          set((s) => ({
            tasks: s.tasks.map((t) => {
              if (taskKey(t) !== key) return t;
              // Terminal state guard: don't update progress for
              // tasks already in a terminal state.
              const TERMINAL_STATES: TaskStatus[] = ['completed', 'partial', 'failed', 'cancelled'];
              if (TERMINAL_STATES.includes(t.Status)) return t;
              return {
                ...t,
                // Progress non-regression: use Math.max to prevent
                // a stale dag:nodeProgress event from lowering the
                // displayed progress.
                Progress: Math.max(t.Progress, progress),
                GalleryProgressInfo: {
                  completed: current,
                  total,
                  failed: failed ?? 0,
                },
              };
            }),
          }));
        } catch (err) {
          logger.warn('SSE dag:nodeProgress parse failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );

    unsubs.push(
      subscribeSseEvent('task:metadata', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data) as {
            taskId: number | string;
            taskType?: string;
            GalleryTitle?: string;
            Person?: string;
            Tags?: unknown;
            Actors?: unknown;
            ImageCount?: number;
            VideoCount?: number;
          };
          const taskType = payload.taskType || 'video';
          const key = `${taskType}-${payload.taskId}`;
          set((s) => ({
            tasks: s.tasks.map((t) => {
              // Match by numeric key first; fall back to DisplayID — some
              // backend emitters historically sent the string seq (e.g.
              // "HSYZH3") as taskId, which never matched the numeric key
              // and silently dropped metadata updates until F5.
              if (taskKey(t) !== key && t.DisplayID !== payload.taskId) return t;
              const next = { ...t };
              if (payload.GalleryTitle !== undefined) {
                next.GalleryTitle = payload.GalleryTitle;
              }
              if (payload.Person !== undefined) {
                next.Person = payload.Person !== 'null' ? payload.Person : '';
              }
              // Live tags/actors from the scrape (normalizeStringArray
              // decodes JSON-string payloads defensively). Only set when
              // non-empty so a tagless re-scrape cannot erase list data.
              if (payload.Tags !== undefined) {
                const tags = normalizeStringArray(payload.Tags);
                if (tags.length > 0) next.Tags = tags;
              }
              if (payload.Actors !== undefined) {
                const actors = normalizeStringArray(payload.Actors);
                if (actors.length > 0) next.Actors = actors;
              }
              if (payload.ImageCount !== undefined) {
                next.ImageCount = payload.ImageCount;
              }
              if (payload.VideoCount !== undefined) {
                next.VideoCount = payload.VideoCount;
              }
              return next;
            }),
          }));
        } catch (err) {
          logger.warn('SSE task:metadata parse failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );

    return () => {
      for (const unsub of unsubs) {
        unsub();
      }
    };
  },

  subscribeToSocket: () => {
    return get().connectSSE();
  },
}));
