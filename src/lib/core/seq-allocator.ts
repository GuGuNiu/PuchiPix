/**
 * 统一编号分配器
 *
 * 视频任务和图包任务共享同一序列，确保编号全局唯一且连续递增。
 * 使用 AppConfig 表中的 unified_seq_counter 键作为计数器。
 *
 * @date 2026-07-13
 */

import prisma from '@/lib/db/prisma';

const COUNTER_KEY = 'unified_seq_counter';

/**
 * 分配下一个统一编号
 *
 * 读取 AppConfig 中的计数器值并递增。
 * 首次调用时若计数器不存在，则从现有数据中计算最大 seq 作为起点。
 *
 * @returns 新分配的编号
 * @date 2026-07-13
 */
export async function allocateSeq(): Promise<number> {
  const config = await prisma.appConfig.findUnique({
    where: { key: COUNTER_KEY },
  });

  let nextSeq: number;

  if (config) {
    nextSeq = parseInt(config.value, 10) + 1;
  } else {
    // 首次初始化：取两表中最大的 seq 作为起点
    const [maxTask, maxGallery] = await Promise.all([
      prisma.downloadTask.aggregate({ _max: { seq: true } }),
      prisma.gallery.aggregate({ _max: { seq: true } }),
    ]);
    const maxTaskSeq = maxTask._max.seq ?? 0;
    const maxGallerySeq = maxGallery._max.seq ?? 0;
    nextSeq = Math.max(maxTaskSeq, maxGallerySeq) + 1;
  }

  await prisma.appConfig.upsert({
    where: { key: COUNTER_KEY },
    create: {
      key: COUNTER_KEY,
      value: String(nextSeq),
    },
    update: {
      value: String(nextSeq),
    },
  });

  return nextSeq;
}
