import { create } from 'zustand';
import type { DownloadTask, TaskStatus } from '@/types';
import { subscribeSseEvent, onSseConnectionState } from '@/lib/sse/shared-sse';
import { createLogger } from '@/lib/core/infra';

const logger = createLogger('TaskStore');

interface TaskStore {
  tasks: DownloadTask[];
  loading: boolean;
  sseConnected: boolean;
  fetchTasks: (status?: string) => Promise<void>;
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

  fetchTasks: async (status?: string) => {
    /*
     * Fallback only: primary data source is SSE initial event.
     * This fetch runs when SSE is disconnected and on manual refresh.
     *
     * Uses /api/tasks/all (unified endpoint) which returns ALL task
     * types (video + gallery + sniff) in a single response — matching
     * the SSE initial event format exactly. Previously this used
     * /api/tasks which ONLY returns video tasks, causing all gallery
     * and sniff tasks to vanish from the store every time fetchTasks()
     * was called (page mount, error recovery, batch search completion).
     */
    set({ loading: true });
    try {
      const res = await fetch(status ? `/api/tasks/all?status=${status}` : '/api/tasks/all');
      const data = await res.json();
      const allTasks = Array.isArray(data) ? data : [];
      const filtered = allTasks.filter((t) => !deletedKeys.has(taskKey(t)));
      set((s) => {
        // Guard: don't clear existing tasks if the server returns an
        // empty array (e.g., database temporarily unavailable). This
        // mirrors the SSE initial event handler's protection.
        if (filtered.length === 0 && s.tasks.length > 0) {
          return { loading: false };
        }
        return { tasks: filtered, loading: false };
      });
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
    /*
     * Shared resident connection: route switching no longer tears down
     * and re-establishes the stream. Pages only subscribe/unsubscribe.
     */
    const unsubs: Array<() => void> = [];

    unsubs.push(
      onSseConnectionState((connState) => {
        set({ sseConnected: connState === 'connected' });
      }),
    );

    unsubs.push(
      subscribeSseEvent('initial', (e: MessageEvent) => {
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
          logger.warn('SSE initial parse failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );

    unsubs.push(
      /*
       * P1-4 semantic event names: task:created (PascalCase DownloadTask
       * struct for video / PascalCase map with TaskType for sniff) +
       * gallery:created (PascalCase map). Was: overloaded "upsert".
       */
      subscribeSseEvent('task:created', (e: MessageEvent) => {
        try {
          const raw = JSON.parse(e.data) as Partial<DownloadTask> & { TaskType?: string };
          const taskType = raw.TaskType || 'video';
          if (taskType === 'gallery') return; // Handled by gallery:created
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
      /*
       * Gallery:created carries a minimal PascalCase map (ID/SourceURL/
       * Status/DagID/DisplayID). Insert a placeholder gallery task so the
       * list reflects new galleries without a page refresh; fetchTasks
       * will reconcile full details later.
       */
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
      /*
       * P1-4 semantic event names: task:progress (camelCase map; gallery
       * carries taskType/completed/total/failed, video carries
       * speed/segment and NO taskType — default to "video"). Was: "patch".
       */
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
            // 260809: live size fields — gallery carries downloadedSize
            // (accumulated bytes of completed images), video carries
            // downloadedBytes (sum of completed segment file sizes).
            downloadedSize?: number;
            downloadedBytes?: number;
          };
          const taskType = payload.taskType || 'video';
          const key = `${taskType}-${payload.taskId}`;
          set((s) => ({
            tasks: s.tasks.map((t) => {
              if (taskKey(t) !== key) return t;
              const next = {
                ...t,
                Progress: payload.progress ?? t.Progress,
                // Map DB-internal "scraped" to the frontend-visible
                // "download_pending" at the SSE boundary (defensive —
                // backend enrichTaskMap already does this, but SSE
                // events from wire_executors.go bypass enrichTaskMap).
                Status: (payload.status === 'scraped' ? 'download_pending' : payload.status as TaskStatus) || t.Status,
              };
              // Video tasks: update Segment/TotalSegments from segment/total
              // fields emitted by DownloadManager.emitProgress().
              if (taskType === 'video' && payload.segment !== undefined && payload.total !== undefined && payload.total > 0) {
                next.Segment = payload.segment;
                next.TotalSegments = payload.total;
              }
              // Video tasks: live downloaded bytes (sum of completed
              // segment file sizes) — the size column updates in real-time
              // instead of showing "—" until the MP4 merge.
              if (taskType === 'video' && payload.downloadedBytes !== undefined && payload.downloadedBytes > 0) {
                next.DownloadedBytes = payload.downloadedBytes;
              }
              // Gallery tasks: update GalleryProgressInfo from completed/total
              if (payload.completed !== undefined && payload.total !== undefined && payload.total > 0) {
                next.GalleryProgressInfo = {
                  completed: payload.completed,
                  total: payload.total,
                  failed: payload.failed ?? 0,
                };
              }
              // Gallery tasks: live downloaded bytes (accumulated size of
              // completed images) — the size column updates in real-time.
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
      /*
       * Task:completed — gallery carries {taskId, taskType, status} where
       * status is "completed"|"partial"; video carries {taskId, title} and
       * no taskType — default to "video", status "completed".
       */
      subscribeSseEvent('task:completed', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data) as {
            taskId: number;
            taskType?: string;
            status?: string;
          };
          const taskType = payload.taskType || 'video';
          const key = `${taskType}-${payload.taskId}`;
          const status = (payload.status || 'completed') as TaskStatus;
          set((s) => ({
            tasks: s.tasks.map((t) =>
              taskKey(t) === key
                ? { ...t, Status: status, Progress: status === 'completed' ? 100 : t.Progress }
                : t,
            ),
          }));
        } catch (err) {
          logger.warn('SSE task:completed parse failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );

    unsubs.push(
      /*
       * Task:failed — only emitted by video path {taskId, error}; no
       * taskType — target video tasks.
       */
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
      /*
       * Task:cancelled — backend payload carries {taskId, taskType}.
       * Use taskType to construct the correct composite key
       * (e.g. "gallery-3" vs "video-3"). Gallery and video task
       * IDs overlap (both are auto-increment starting from 1), so
       * resolving by ID alone (find) would match the wrong task
       * type — e.g. deleting gallery #3 via CLI would remove video
       * task #3 from the list instead.
       */
      subscribeSseEvent('task:cancelled', (e: MessageEvent) => {
        try {
          const raw = JSON.parse(e.data) as { taskId: number; taskType?: string };
          const taskId = raw.taskId;
          const taskType = raw.taskType || 'video';
          const key = `${taskType}-${taskId}`;
          /*
           * Mark as deleted so subsequent SSE events (task:created,
           * initial) don't re-insert the cancelled task before the
           * next full refresh clears deletedKeys.
           */
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
      /*
       * Dag:nodeProgress — camelCase map {dagId, nodeId, phase, current,
       * total, failed, taskType}. Was: "nodeProgress".
       */
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
            // Backend carries the entity ID directly since DAG IDs were
            // unified to 6-char random codes (260804); parsing "gallery-"
            // prefixes from dagId no longer works.
            galleryId?: number;
            taskId?: number;
            sniffId?: number;
          };
          // Prefer the explicit entity ID carried by the backend.
          // Fall back to the legacy "gallery-<id>" prefix parse only for
          // old payloads (pre-260804 DAG ID format).
          let gallery = galleryId ?? NaN;
          if (isNaN(gallery) && dagId.startsWith('gallery-')) {
            gallery = parseInt(dagId.replace('gallery-', ''), 10);
          }
          if (isNaN(gallery)) return;
          const key = `gallery-${gallery}`;
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
          logger.warn('SSE dag:nodeProgress parse failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );

    unsubs.push(
      /*
       * Task:metadata — pushed when scraping completes (title, person,
       * image/video counts become available) or when video info is
       * finalized (final title, actors). Bridges the gap between DB
       * writes and frontend state so the Tasks page reflects metadata
       * changes without requiring F5 refresh.
       */
      subscribeSseEvent('task:metadata', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data) as {
            taskId: number;
            taskType?: string;
            GalleryTitle?: string;
            Person?: string;
            ImageCount?: number;
            VideoCount?: number;
          };
          const taskType = payload.taskType || 'video';
          const key = `${taskType}-${payload.taskId}`;
          set((s) => ({
            tasks: s.tasks.map((t) => {
              if (taskKey(t) !== key) return t;
              const next = { ...t };
              if (payload.GalleryTitle !== undefined) {
                next.GalleryTitle = payload.GalleryTitle;
              }
              if (payload.Person !== undefined) {
                next.Person = payload.Person !== 'null' ? payload.Person : '';
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
      /*
       * The shared connection lives for the whole App lifetime; here we
       * only unsubscribe. We neither close it nor reset sseConnected to
       * false (connection state is broadcast by the shared layer).
       */
    };
  },

  subscribeToSocket: () => {
    return get().connectSSE();
  },
}));
