import { create } from 'zustand';
import type { DownloadTask, ProgressMessage } from '@/types';
import { useSocketStore } from './socket-store';

interface TaskCreatedMessage {
  taskId: number;
  title?: string;
  source?: string;
}

interface TaskCompletedMessage {
  taskId: number;
  title?: string;
}

interface TaskFailedMessage {
  taskId: number;
  error: string;
}

interface TaskCancelledMessage {
  taskId: number;
}

interface TaskStore {
  tasks: DownloadTask[];
  loading: boolean;
  fetchTasks: (status?: string) => Promise<void>;
  addTask: (task: DownloadTask) => void;
  updateTask: (id: number, updates: Partial<DownloadTask>) => void;
  removeTask: (id: number) => void;
  /** 订阅 WebSocket 事件以实时更新任务状态 */
  subscribeToSocket: () => () => void;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  loading: false,
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
  addTask: (task) => set((s) => ({ tasks: [task, ...s.tasks] })),
  updateTask: (id, updates) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.ID === id ? { ...t, ...updates } : t)),
    })),
  removeTask: (id) =>
    set((s) => ({ tasks: s.tasks.filter((t) => t.ID !== id) })),
  subscribeToSocket: () => {
    let refetchTimer: ReturnType<typeof setTimeout> | null = null;
    let currentSocket: ReturnType<typeof useSocketStore.getState>['socket'] = null;

    const scheduleRefetch = () => {
      if (refetchTimer) return;
      refetchTimer = setTimeout(() => {
        refetchTimer = null;
        get().fetchTasks();
      }, 500);
    };

    const handleProgress = (msg: ProgressMessage) => {
      const { tasks, updateTask } = get();
      const task = tasks.find((t) => t.ID === msg.task_id);

      // 收到未知任务的进度，说明有新任务被创建，触发刷新
      if (!task) {
        scheduleRefetch();
        return;
      }

      const updates: Partial<DownloadTask> = {
        Progress: msg.progress,
      };

      if (msg.segment !== undefined) {
        updates.Segment = msg.segment;
      }
      if (msg.total !== undefined) {
        updates.TotalSegments = msg.total;
      }

      if (msg.status) {
        updates.Status = msg.status as DownloadTask['Status'];
      }

      if (msg.progress >= 100 && msg.status === 'completed') {
        updates.Status = 'completed';
      }

      updateTask(msg.task_id, updates);
    };

    const handleTaskCreated = (_msg: TaskCreatedMessage) => {
      scheduleRefetch();
    };

    const handleTaskCompleted = (msg: TaskCompletedMessage) => {
      get().updateTask(msg.taskId, { Status: 'completed', Progress: 100 });
    };

    const handleTaskFailed = (msg: TaskFailedMessage) => {
      get().updateTask(msg.taskId, { Status: 'failed', ErrorMsg: msg.error });
    };

    const handleTaskCancelled = (msg: TaskCancelledMessage) => {
      get().updateTask(msg.taskId, { Status: 'cancelled' });
    };

    const handleTaskScraped = () => {
      scheduleRefetch();
    };

    // Gallery 事件：收到后触发刷新以同步图库任务状态
    const handleGalleryEvent = () => {
      scheduleRefetch();
    };

    const galleryEvents = [
      'gallery:scrapeStarted',
      'gallery:scrapeCompleted',
      'gallery:scrapeFailed',
      'gallery:downloadStarted',
      'gallery:downloadProgress',
      'gallery:downloadCompleted',
      'gallery:downloadFailed',
      'gallery:zipDownloadCompleted',
      'gallery:zipExtractCompleted',
      'gallery:zipExtractFailed',
    ];

    const attach = (socket: NonNullable<typeof currentSocket>) => {
      socket.on('progress', handleProgress);
      socket.on('task:created', handleTaskCreated);
      socket.on('task:completed', handleTaskCompleted);
      socket.on('task:failed', handleTaskFailed);
      socket.on('task:cancelled', handleTaskCancelled);
      socket.on('task:scraped', handleTaskScraped);
      for (const evt of galleryEvents) {
        socket.on(evt, handleGalleryEvent);
      }
    };

    const detach = (socket: NonNullable<typeof currentSocket>) => {
      socket.off('progress', handleProgress);
      socket.off('task:created', handleTaskCreated);
      socket.off('task:completed', handleTaskCompleted);
      socket.off('task:failed', handleTaskFailed);
      socket.off('task:cancelled', handleTaskCancelled);
      socket.off('task:scraped', handleTaskScraped);
      for (const evt of galleryEvents) {
        socket.off(evt, handleGalleryEvent);
      }
    };

    // 如果 socket 已存在，直接绑定
    const initial = useSocketStore.getState().socket;
    if (initial) {
      currentSocket = initial;
      attach(initial);
    }

    // 监听 socket 变化，当 socket 被创建/替换时自动重新绑定
    const unsubSocketStore = useSocketStore.subscribe((state, prevState) => {
      if (state.socket === prevState.socket) return;

      if (currentSocket) {
        detach(currentSocket);
      }
      currentSocket = state.socket;
      if (currentSocket) {
        attach(currentSocket);
      }
    });

    return () => {
      if (refetchTimer) {
        clearTimeout(refetchTimer);
        refetchTimer = null;
      }
      if (currentSocket) {
        detach(currentSocket);
      }
      unsubSocketStore();
    };
  },
}));
