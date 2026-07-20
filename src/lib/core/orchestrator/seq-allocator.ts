import { randomInt } from 'crypto';
import prisma from '@/lib/db/prisma';
import { loggers } from '../infra/logger';

const logger = loggers.seqAllocator();

const SAFE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const ID_LENGTH = 6;
const MAX_UNIQUENESS_RETRIES = 10;

function generateRandomId(): string {
  let result = '';
  for (let i = 0; i < ID_LENGTH; i++) {
    const idx = randomInt(0, SAFE_CHARS.length);
    result += SAFE_CHARS[idx];
  }
  return result;
}

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

export async function allocateSeq(): Promise<string> {
  for (let i = 0; i < MAX_UNIQUENESS_RETRIES; i++) {
    const candidate = generateRandomId();
    const taken = await isIdTaken(candidate);
    if (!taken) {
      return candidate;
    }
    logger.warn(`Seq ${candidate} collision, retrying (${i + 1}/${MAX_UNIQUENESS_RETRIES})`);
  }
  throw new Error('Failed to allocate a unique seq after maximum retries');
}
