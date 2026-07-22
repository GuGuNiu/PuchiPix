"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type {
  DownloadTask,
  GalleryData,
  Stats,
  GalleryImageData,
} from "@/types";

// ---------------------------------------------------------------------------
// Shared fetch helpers
// ---------------------------------------------------------------------------

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.error ?? res.statusText, body);
  }
  return res.json();
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ---------------------------------------------------------------------------
// Task queries
// ---------------------------------------------------------------------------

export function useTasksQuery(options?: Partial<UseQueryOptions<DownloadTask[]>>) {
  return useQuery<DownloadTask[]>({
    queryKey: ["tasks"],
    queryFn: () => fetchJSON<DownloadTask[]>("/api/tasks"),
    ...options,
  });
}

export function useTaskQuery(id: number, options?: Partial<UseQueryOptions<DownloadTask>>) {
  return useQuery<DownloadTask>({
    queryKey: ["tasks", id],
    queryFn: () => fetchJSON<DownloadTask>(`/api/tasks/${id}`),
    enabled: id > 0,
    ...options,
  });
}

export function useCreateTaskMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { url: string; format?: string; seq?: string; priority?: number }) =>
      fetchJSON<{ id: number; status: string }>("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

export function useTaskActionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: string }) =>
      fetchJSON<{ id: number; status: string }>(`/api/tasks/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

export function useDeleteTaskMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJSON<unknown>(`/api/tasks/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

// ---------------------------------------------------------------------------
// Gallery / Shelf queries
// ---------------------------------------------------------------------------

export function useShelfQuery(options?: Partial<UseQueryOptions<GalleryData[]>>) {
  return useQuery<GalleryData[]>({
    queryKey: ["shelf"],
    queryFn: () => fetchJSON<GalleryData[]>("/api/shelf?limit=500"),
    ...options,
  });
}

export function useGalleryQuery(id: number, options?: Partial<UseQueryOptions<GalleryData>>) {
  return useQuery<GalleryData>({
    queryKey: ["shelf", id],
    queryFn: () => fetchJSON<GalleryData>(`/api/shelf/${id}`),
    enabled: id > 0,
    ...options,
  });
}

export function useGalleryImagesQuery(
  id: number,
  options?: Partial<UseQueryOptions<GalleryImageData[]>>
) {
  return useQuery<GalleryImageData[]>({
    queryKey: ["shelf", id, "images"],
    queryFn: () => fetchJSON<GalleryImageData[]>(`/api/shelf/${id}/images`),
    enabled: id > 0,
    ...options,
  });
}

export function useDeleteGalleryMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJSON<{ id: number; deleted: boolean }>(`/api/shelf/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shelf"] }),
  });
}

export function useGalleryActionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: string; manualUrl?: string }) =>
      fetchJSON<{ id: number; success?: boolean }>(`/api/shelf/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shelf"] }),
  });
}

// ---------------------------------------------------------------------------
// Stats query
// ---------------------------------------------------------------------------

export function useStatsQuery(options?: Partial<UseQueryOptions<Stats>>) {
  return useQuery<Stats>({
    queryKey: ["stats"],
    queryFn: () => fetchJSON<Stats>("/api/stats"),
    refetchInterval: 30_000,
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Preferences query
// ---------------------------------------------------------------------------

export function usePreferencesQuery() {
  return useQuery<Array<{ key: string; value: string; category: string }>>({
    queryKey: ["preferences"],
    queryFn: () => fetchJSON("/api/preferences"),
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdatePreferenceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { key: string; value: string; category?: string }) =>
      fetchJSON("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["preferences"] }),
  });
}
