import { randomInt } from 'crypto';
import prisma from '@/lib/db/prisma';

/** 安全字符集：排除 0/O（易混淆）、1/I（易混淆）、L（与 1 混淆） */
const SAFE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const ID_LENGTH = 6;
const MAX_UNIQUENESS_RETRIES = 10;

/**
 * 生成一个随机 6 位编号
 *
 * 使用 crypto.randomInt 确保加密级随机性，
 * 避免伪随机数在批量创建时的碰撞。
 */
function generateRandomId(): string {
  let result = '';
  for (let i = 0; i < ID_LENGTH; i++) {
    const idx = randomInt(0, SAFE_CHARS.length);
    result += SAFE_CHARS[idx];
  }
  return result;
}

/**
 * 检查编号在视频任务、图库和嗅探任务中是否已存在
 *
 * 所有任务类型共享同一编号空间，确保全局唯一性。
 */
async function isIdTaken(id: string): Promise<boolean> {
  const [task, gallery, sniff] = await Promise.all([
    prisma.downloadTask.findFirst({
      where: { seq: id },
      select: { id: true },
    }),
    prisma.gallery.findFirst({
      where: { seq: id },
      select: { id: true },
    }),
    prisma.sniffTask.findFirst({
      where: { seq: id },
      select: { id: true },
    }),
  ]);
  return task !== null || gallery !== null || sniff !== null;
}

/**
 * 分配下一个统一编号（视频任务、图包和嗅探任务共享）
 *
 * 生成一个随机 6 位安全字符编号，并确保在全局范围内不重复。
 * 若与现有编号碰撞（极低概率），自动重试生成。
 *
 * @returns 新分配的编号字符串
 */
export async function allocateSeq(): Promise<string> {
  for (let i = 0; i < MAX_UNIQUENESS_RETRIES; i++) {
    const candidate = generateRandomId();
    const taken = await isIdTaken(candidate);
    if (!taken) {
      return candidate;
    }
    console.warn(`[SeqAllocator] 编号 ${candidate} 碰撞，重试 (${i + 1}/${MAX_UNIQUENESS_RETRIES})`);
  }
  // 理论上极不可能到达此处（30^6 ≈ 7.29 亿组合）
  throw new Error('Failed to allocate a unique seq after maximum retries');
}
