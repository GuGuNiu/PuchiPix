import { create } from 'zustand';
import { createLogger } from '@/lib/core/infra';

const logger = createLogger('SniffStore');

/*
 * SniffTask mirrors the backend SniffTask JSON (PascalCase keys from
 * internal/db/models.go). The /api/sniff endpoints manage sniff tasks:
 * GET  /api/sniff      - task list
 * POST /api/sniff      - { url, siteId } creates a task, executed via DAG
 * DELETE /api/sniff?id= - remove a task
 */
export interface SniffTask {
  ID: number;
  DisplayID: string | null;
  URL: string;
  SiteID: string;
  Status: string; // Possible values: pending, scraping, running, completed, failed
  TotalFound: number;
  TotalCreated: number;
  TotalSkipped: number;
  ErrorMsg: string;
  CompletedAt: string | null;
  CreatedAt: string;
  UpdatedAt: string;
}

export const SNIFF_ACTIVE_STATUSES = ['pending', 'scraping', 'running'] as const;

interface SniffStore {
  tasks: SniffTask[];
  loading: boolean;
  fetchTasks: () => Promise<void>;
  startSniff: (url: string) => Promise<void>;
  deleteSniff: (id: number) => Promise<void>;
}

export const useSniffStore = create<SniffStore>((set) => ({
  tasks: [],
  loading: false,

  fetchTasks: async () => {
    try {
      const res = await fetch('/api/sniff');
      if (!res.ok) return;
      const data = await res.json();
      set({ tasks: Array.isArray(data) ? data : [], loading: false });
    } catch (err) {
      logger.warn('fetchTasks failed', { error: err instanceof Error ? err.message : String(err) });
      set({ loading: false });
    }
  },

  startSniff: async (url) => {
    const res = await fetch('/api/sniff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Failed to start sniffing');
    }
  },

  deleteSniff: async (id) => {
    const res = await fetch(`/api/sniff?id=${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete sniff task');
  },
}));
