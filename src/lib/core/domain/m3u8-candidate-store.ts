import type { M3U8Candidate } from '@/types';

const store = new Map<number, M3U8Candidate[]>();

/**
 *
 * @param taskId - Downloadtask ID
 */
export function setM3U8Candidates(taskId: number, candidates: M3U8Candidate[]): void {
  store.set(taskId, candidates);
}

/**
 *
 * @param taskId - Downloadtask ID
 */
export function getM3U8Candidates(taskId: number): M3U8Candidate[] | undefined {
  return store.get(taskId);
}

/**
 *
 *
 * @param taskId - Downloadtask ID
 */
export function deleteM3U8Candidates(taskId: number): void {
  store.delete(taskId);
}

/**
 *
 * @returns task ID Array
 */
export function getAllPendingTaskIds(): number[] {
  return Array.from(store.keys());
}
