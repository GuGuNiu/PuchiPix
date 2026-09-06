import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Persistent video playlist for the shelf player.
 *
 * Queue IDs survive page reloads (zustand persist → localStorage) so the
 * user can curate a "watch later" list over multiple sessions. The modal
 * resolves IDs against the freshest /api/videos payload at render time,
 * so deleted or unfinished entries are skipped gracefully instead of
 * stale item snapshots living in storage.
 */
interface PlaylistState {
  queueIds: number[];
  currentId: number | null;
  /** Append one id (no-op when present) and optionally make it current. */
  addToQueue: (id: number, playAfter?: boolean) => void;
  /** Append many ids preserving order, then make the first playable one current. */
  addManyToQueue: (ids: number[]) => void;
  removeFromQueue: (id: number) => void;
  clearQueue: () => void;
  /** Swap a queue entry with its neighbor (index-1 / index+1). */
  moveInQueue: (id: number, delta: -1 | 1) => void;
  setCurrent: (id: number | null) => void;
  /** Advance to the next queue entry; false when already at the end. */
  next: () => boolean;
  /** Step back to the previous queue entry; false when already at the start. */
  prev: () => boolean;
}

export const useVideoPlaylistStore = create<PlaylistState>()(
  persist(
    (set, get) => ({
      queueIds: [],
      currentId: null,

      addToQueue: (id, playAfter = false) =>
        set((s) => {
          const queueIds = s.queueIds.includes(id)
            ? s.queueIds
            : [...s.queueIds, id];
          return {
            queueIds,
            currentId: playAfter ? id : s.currentId,
          };
        }),

      addManyToQueue: (ids) =>
        set((s) => {
          const merged = [...s.queueIds];
          for (const id of ids) {
            if (!merged.includes(id)) merged.push(id);
          }
          const currentId =
            s.currentId != null && merged.includes(s.currentId)
              ? s.currentId
              : (ids[0] ?? null);
          return { queueIds: merged, currentId };
        }),

      removeFromQueue: (id) =>
        set((s) => {
          const queueIds = s.queueIds.filter((v) => v !== id);
          let currentId = s.currentId;
          if (currentId === id) {
            // Jump current to the entry that took the removed slot.
            const idx = s.queueIds.indexOf(id);
            currentId = queueIds[Math.min(idx, queueIds.length - 1)] ?? null;
          }
          return { queueIds, currentId };
        }),

      clearQueue: () => set({ queueIds: [], currentId: null }),

      moveInQueue: (id, delta) =>
        set((s) => {
          const idx = s.queueIds.indexOf(id);
          const to = idx + delta;
          if (idx < 0 || to < 0 || to >= s.queueIds.length) return s;
          const queueIds = [...s.queueIds];
          [queueIds[idx], queueIds[to]] = [queueIds[to], queueIds[idx]];
          return { queueIds };
        }),

      setCurrent: (id) => set({ currentId: id }),

      next: () => {
        const { queueIds, currentId } = get();
        if (queueIds.length === 0) return false;
        const idx = currentId != null ? queueIds.indexOf(currentId) : -1;
        if (idx < 0) {
          set({ currentId: queueIds[0] });
          return true;
        }
        if (idx >= queueIds.length - 1) return false;
        set({ currentId: queueIds[idx + 1] });
        return true;
      },

      prev: () => {
        const { queueIds, currentId } = get();
        const idx = currentId != null ? queueIds.indexOf(currentId) : -1;
        if (idx <= 0) return false;
        set({ currentId: queueIds[idx - 1] });
        return true;
      },
    }),
    {
      name: "puchipix-video-playlist",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ queueIds: s.queueIds, currentId: s.currentId }),
    },
  ),
);
