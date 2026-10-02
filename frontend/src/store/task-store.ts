import { create } from 'zustand';
import type { DownloadTask, TaskStatus } from '@/types';
import { subscribeSseEvent, onSseConnectionState } from '@/lib/sse/shared-sse';
import { createLogger } from '@/lib/core/infra';
import { getAllowedActions, normalizeStringArray } from '@/pages/tasks/_lib/task-helpers';

const logger = createLogger('TaskStore');

interface TaskStore {
  tasks: DownloadTask[];
  loading: boolean;
  loadError: string | null;
  batchActionInProgress: boolean;
  setBatchActionInProgress: (value: boolean) => void;
  sseConnected: boolean;
  totalCount: number;
  currentPage: number;
  hasMore: boolean;
  loadingMore: boolean;
  fetchTasks: (status?: string) => Promise<void>;
  loadMoreTasks: () => Promise<void>;
  addTask: (task: DownloadTask) => void;
  updateTask: (id: number, taskType: string, patch: Partial<DownloadTask>) => void;
  markTaskAction: (id: number, taskType: string) => void;
  clearTaskAction: (id: number, taskType: string) => void;
  removeTask: (id: number, taskType?: string) => void;
  clearDeletedKey: (id: number, taskType: string) => void;
  connectSSE: () => () => void;
  subscribeToSocket: () => () => void;
}

function taskKey(t: DownloadTask): string {
  return `${t.TaskType || 'video'}-${t.ID}`;
}

const deletedKeys = new Set<string>();
const pendingTaskActions = new Set<string>();
const terminalStatuses = new Set<TaskStatus>(['completed', 'partial', 'failed', 'cancelled']);
let aggregateRefetchTimer: ReturnType<typeof setTimeout> | null = null;

function isTerminalStatus(status: TaskStatus): boolean {
  return terminalStatuses.has(status);
}

function applyStatus(task: DownloadTask, status: TaskStatus): DownloadTask {
  return {
    ...task,
    Status: status,
    EffectiveStatus: status,
    AllowedActions: getAllowedActions(status, task.TaskType),
  };
}

function markDeleted(key: string): void {
  deletedKeys.add(key);
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  loading: true,
  loadError: null,
  batchActionInProgress: false,
  setBatchActionInProgress: (value) => set({ batchActionInProgress: value }),
  sseConnected: false,
  totalCount: 0,
  currentPage: 0,
  hasMore: false,
  loadingMore: false,

  fetchTasks: async (status?: string) => {
    set({ loading: true, loadError: null });
    try {
      const res = await fetch(status ? `/api/tasks/all?status=${encodeURIComponent(status)}` : '/api/tasks/all');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`);
      }
      const rawTasks: DownloadTask[] = Array.isArray(data) ? data : (data.tasks || []);
      const totalCount = Array.isArray(data) ? rawTasks.length : (data.totalCount ?? rawTasks.length);
      const incomingHasMore = Array.isArray(data) ? false : (data.hasMore || false);
      const filtered = rawTasks.filter((t: DownloadTask) => !deletedKeys.has(taskKey(t)));
      deletedKeys.clear();
      set((s) => ({
        tasks: filtered,
        loading: false,
        loadError: null,
        totalCount,
        hasMore: incomingHasMore || (Array.isArray(data) ? s.hasMore : false),
        currentPage: 1,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, loadError: message });
    }
  },

  loadMoreTasks: async () => {
    const { loadingMore, hasMore } = get();
    if (loadingMore || !hasMore) return;

    const nextPage = get().currentPage + 1;
    set({ loadingMore: true });
    try {
      const res = await fetch(`/api/tasks/page?page=${nextPage}&pageSize=100`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`);
      }
      const newTasks = (data.tasks || []) as DownloadTask[];
      set((s) => {
        if (s.currentPage !== nextPage - 1) return { loadingMore: false };
        const existingKeys = new Set(s.tasks.map(taskKey));
        const uniqueNewTasks = newTasks.filter((t) => !existingKeys.has(taskKey(t)) && !deletedKeys.has(taskKey(t)));
        return {
          tasks: [...s.tasks, ...uniqueNewTasks],
          currentPage: nextPage,
          totalCount: data.totalCount ?? s.totalCount,
          hasMore: data.hasMore ?? false,
          loadingMore: false,
        };
      });
    } catch {
      set({ loadingMore: false });
    }
  },

  addTask: (task) => set((s) => {
    const key = taskKey(task);
    const index = s.tasks.findIndex((t) => taskKey(t) === key);
    if (index < 0) return { tasks: [task, ...s.tasks] };
    const next = [...s.tasks];
    next[index] = { ...next[index], ...task };
    return { tasks: next };
  }),

  updateTask: (id, taskType, patch) => set((s) => {
    const key = `${taskType}-${id}`;
    return {
      tasks: s.tasks.map((t) =>
        taskKey(t) === key ? { ...t, ...patch } : t,
      ),
    };
  }),

  markTaskAction: (id, taskType) => {
    pendingTaskActions.add(`${taskType}-${id}`);
  },
  clearTaskAction: (id, taskType) => {
    pendingTaskActions.delete(`${taskType}-${id}`);
  },

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
           set({
             tasks: filtered,
             loading: false,
             loadError: null,
             totalCount,
             hasMore,
             currentPage: 1,
           });
         } catch (err) {
           const message = err instanceof Error ? err.message : String(err);
           logger.warn('SSE initial parse failed', { error: message });
           set({ loading: false, loadError: message });
         }
      }),
    );

    unsubs.push(
      subscribeSseEvent('task:created', (e: MessageEvent) => {
        try {
          const raw = JSON.parse(e.data) as Partial<DownloadTask> & { TaskType?: string };
          const taskType = raw.TaskType || 'video';
           if (taskType === 'gallery' || taskType === 'sniff') return;
          const task = { ...raw, TaskType: taskType } as DownloadTask;
          const key = taskKey(task);
          if (deletedKeys.has(key)) return;
          set((s) => {
            const idx = s.tasks.findIndex((t) => taskKey(t) === key);
             if (idx >= 0) {
               const newTasks = [...s.tasks];
               newTasks[idx] = { ...newTasks[idx], ...task };
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
            phaseProgress?: number;
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
          set((s) => ({
             tasks: s.tasks.map((t) => {
               if (taskKey(t) !== key) return t;
               const incomingStatus = payload.status === 'scraped' ? 'download_pending' : payload.status as TaskStatus;
               const incomingTerminal = incomingStatus ? isTerminalStatus(incomingStatus) : false;
               if (isTerminalStatus(t.Status) && incomingStatus && !incomingTerminal && !pendingTaskActions.has(key)) {
                 return t;
               }
              /*
               * payload.progress is the backend-computed monotonic composite
               * scale (download 0-90 → merge 90-95 → transcode 95-99 → 100),
               * so the non-regression guard holds across phase boundaries
               * without any phase-specific bypass. A status change is still
               * taken raw: it marks a real restart (retry/resume) whose
               * composite legitimately starts below the previous value.
               */
              const statusChanged = incomingStatus !== undefined && incomingStatus !== t.Status;
              const next = {
                ...t,
                 Progress: payload.progress !== undefined
                   ? (statusChanged ||
                      payload.segment !== undefined &&
                         typeof t.Segment === 'number' &&
                         payload.segment < t.Segment
                         ? payload.progress
                         : Math.max(t.Progress, payload.progress))
                  : t.Progress,
                 PhaseProgress: payload.phaseProgress ?? t.PhaseProgress,
                 Status: incomingStatus || t.Status,
                 EffectiveStatus: incomingStatus || t.EffectiveStatus,
                 AllowedActions: incomingStatus
                   ? getAllowedActions(incomingStatus, t.TaskType)
                   : t.AllowedActions,
                 ProgressStage: incomingStatus === 'merging'
                   ? 'tasks.progressStageMerging'
                   : incomingStatus === 'transcoding'
                     ? 'tasks.progressStageTranscoding'
                     : incomingStatus === 'probing'
                       ? 'tasks.progressStageProbing'
                       : t.ProgressStage,
                 Speed: payload.speed || undefined,
              };
              /*
               * Only download-phase events feed the segment capsule: merge
               * events reuse `segment` for the merge count (restarts at 0)
               * and would otherwise roll the capsule back mid-pipeline.
               */
              if (taskType === 'video' && payload.status === 'downloading' && payload.segment !== undefined && payload.total !== undefined && payload.total > 0) {
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
      subscribeSseEvent('events:aggregated', () => {
        /*
         * The server replaced individual events (progress is sheddable under
         * load) with a count-only summary. The dropped frames may include
         * status transitions, so re-sync from the API once the burst
         * settles instead of waiting for the next per-task event.
         */
        if (aggregateRefetchTimer !== null) {
          clearTimeout(aggregateRefetchTimer);
        }
        aggregateRefetchTimer = setTimeout(() => {
          aggregateRefetchTimer = null;
          if (!get().loading) {
            void get().fetchTasks();
          }
        }, 800);
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
          const allowPending = pendingTaskActions.has(key);
          set((s) => ({
             tasks: s.tasks.map((t) => {
               if (taskKey(t) !== key) return t;
               if (isTerminalStatus(t.Status) && t.Status !== status && !allowPending) return t;
               pendingTaskActions.delete(key);
               return {
                 ...t,
                 Status: status,
                 EffectiveStatus: status,
                 AllowedActions: getAllowedActions(status, t.TaskType),
                 Progress: payload.progress !== undefined
                   ? Math.max(t.Progress, payload.progress)
                   : status === 'completed' ? 100 : t.Progress,
               };
             }),
          }));
        } catch (err) {
           logger.warn('SSE task:completed parse failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );

    unsubs.push(
      subscribeSseEvent('task:failed', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data) as { taskId: number; taskType?: string; error?: string };
          // Gallery and sniff executors set TaskType on the event payload
           const taskType = payload.taskType || 'video';
           const key = `${taskType}-${payload.taskId}`;
           const allowPending = pendingTaskActions.has(key);
           set((s) => ({
             tasks: s.tasks.map((t) => {
               if (taskKey(t) !== key) return t;
               if (isTerminalStatus(t.Status) && t.Status !== 'failed' && !allowPending) return t;
               pendingTaskActions.delete(key);
               return {
                 ...t,
                 Status: 'failed' as TaskStatus,
                 EffectiveStatus: 'failed' as TaskStatus,
                 AllowedActions: getAllowedActions('failed', t.TaskType),
                 ErrorMsg: payload.error || t.ErrorMsg,
               };
             }),
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
          const taskType = raw.taskType || 'video';
          const key = `${taskType}-${raw.taskId}`;
          pendingTaskActions.delete(key);
          set((s) => ({
            tasks: s.tasks.map((task) => {
              if (taskKey(task) !== key) return task;
              return applyStatus(task, 'cancelled');
            }),
          }));
        } catch (err) {
          logger.warn('SSE task:cancelled parse failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );

    unsubs.push(
      subscribeSseEvent('task:deleted', (e: MessageEvent) => {
        try {
          const raw = JSON.parse(e.data) as { taskId: number; taskType?: string };
          const taskType = raw.taskType || 'video';
          const key = `${taskType}-${raw.taskId}`;
          pendingTaskActions.delete(key);
          markDeleted(key);
          set((s) => ({ tasks: s.tasks.filter((task) => taskKey(task) !== key) }));
        } catch (err) {
          logger.warn('SSE task:deleted parse failed', { error: err instanceof Error ? err.message : String(err) });
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
               if (isTerminalStatus(t.Status)) return t;
              return {
                ...t,
                /*
                 * Non-regression: a stale dag:nodeProgress event must not lower
                 * the displayed progress
                 */
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
              /*
               * DisplayID fallback: some backend emitters send the string seq
               * (e.g. "HSYZH3") as taskId, which never matches the numeric key.
               */
              if (taskKey(t) !== key && String(t.DisplayID) !== String(payload.taskId)) return t;
              const next = { ...t };
              if (payload.GalleryTitle !== undefined) {
                next.GalleryTitle = payload.GalleryTitle;
              }
              if (payload.Person !== undefined) {
                next.Person = payload.Person !== 'null' ? payload.Person : '';
              }
              /*
               * Applied only when non-empty so a tagless re-scrape cannot erase
               * already collected tags and actors.
               */
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
