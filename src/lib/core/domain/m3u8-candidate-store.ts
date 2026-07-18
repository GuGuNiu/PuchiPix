import type { M3U8Candidate } from '@/types';

const store = new Map<number, M3U8Candidate[]>();

/**
 * 存储 M3U8 候选项。
 *
 * @param taskId - 下载任务 ID
 * @param candidates - M3U8 候选项数组
 */
export function setM3U8Candidates(taskId: number, candidates: M3U8Candidate[]): void {
  store.set(taskId, candidates);
}

/**
 * 获取 M3U8 候选项。
 *
 * @param taskId - 下载任务 ID
 * @returns 候选项数组，不存在则返回 undefined
 */
export function getM3U8Candidates(taskId: number): M3U8Candidate[] | undefined {
  return store.get(taskId);
}

/**
 * 删除 M3U8 候选项。
 *
 * 用户选择后或任务删除时调用。
 *
 * @param taskId - 下载任务 ID
 */
export function deleteM3U8Candidates(taskId: number): void {
  store.delete(taskId);
}

/**
 * 获取所有待选择的任务 ID 列表。
 *
 * @returns 任务 ID 数组
 */
export function getAllPendingTaskIds(): number[] {
  return Array.from(store.keys());
}
