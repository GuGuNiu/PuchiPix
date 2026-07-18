import { create } from 'zustand';
import type { CapturedURL, SniffStatus } from '@/types';

interface SniffStore {
  status: SniffStatus | null;
  urls: CapturedURL[];
  loading: boolean;
  fetchStatus: () => Promise<void>;
  fetchURLs: (type?: string) => Promise<void>;
  startSniff: (url: string) => Promise<void>;
  stopSniff: () => Promise<void>;
}

export const useSniffStore = create<SniffStore>((set) => ({
  status: null,
  urls: [],
  loading: false,
  fetchStatus: async () => {
    try {
      const res = await fetch('/api/sniff/status');
      set({ status: await res.json() });
    } catch (err) {
      console.warn('[SniffStore] fetchStatus failed:', err instanceof Error ? err.message : String(err));
    }
  },
  fetchURLs: async (type?: string) => {
    try {
      const url = type ? `/api/sniff/urls?type=${type}` : '/api/sniff/urls';
      const res = await fetch(url);
      set({ urls: await res.json() });
    } catch (err) {
      console.warn('[SniffStore] fetchURLs failed:', err instanceof Error ? err.message : String(err));
    }
  },
  startSniff: async (url) => {
    set({ loading: true });
    const res = await fetch('/api/sniff/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    set({ loading: false });
    if (!res.ok) throw new Error('Failed to start sniffing');
  },
  stopSniff: async () => {
    await fetch('/api/sniff/stop', { method: 'POST' });
  },
}));