import { randomInt } from 'crypto';
import prisma from '@/lib/db/prisma';

/** 瀹夊叏瀛楃闆嗭細鎺掗櫎 0/O锛堟槗娣锋穯锛夈€?/I锛堟槗娣锋穯锛夈€丩锛堜笌 1 娣锋穯锛?*/
const SAFE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const ID_LENGTH = 6;
const MAX_UNIQUENESS_RETRIES = 10;

/**
 * 鐢熸垚涓€涓殢鏈?6 浣嶇紪鍙?
 *
 * 浣跨敤 crypto.randomInt 纭繚鍔犲瘑绾ч殢鏈烘€э紝
 * 閬垮厤浼殢鏈烘暟鍦ㄦ壒閲忓垱寤烘椂鐨勭鎾炪€?
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
 * 妫€鏌ョ紪鍙峰湪瑙嗛浠诲姟銆佸浘搴撳拰鍡呮帰浠诲姟涓槸鍚﹀凡瀛樺湪
 *
 * 鎵€鏈変换鍔＄被鍨嬪叡浜悓涓€缂栧彿绌洪棿锛岀‘淇濆叏灞€鍞竴鎬с€?
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
 * 鍒嗛厤涓嬩竴涓粺涓€缂栧彿锛堣棰戜换鍔°€佸浘鍖呭拰鍡呮帰浠诲姟鍏变韩锛?
 *
 * 鐢熸垚涓€涓殢鏈?6 浣嶅畨鍏ㄥ瓧绗︾紪鍙凤紝骞剁‘淇濆湪鍏ㄥ眬鑼冨洿鍐呬笉閲嶅銆?
 * 鑻ヤ笌鐜版湁缂栧彿纰版挒锛堟瀬浣庢鐜囷級锛岃嚜鍔ㄩ噸璇曠敓鎴愩€?
 *
 * @returns 鏂板垎閰嶇殑缂栧彿瀛楃涓?
 */
export async function allocateSeq(): Promise<string> {
  for (let i = 0; i < MAX_UNIQUENESS_RETRIES; i++) {
    const candidate = generateRandomId();
    const taken = await isIdTaken(candidate);
    if (!taken) {
      return candidate;
    }
    console.warn(`[SeqAllocator] 缂栧彿 ${candidate} 纰版挒锛岄噸璇?(${i + 1}/${MAX_UNIQUENESS_RETRIES})`);
  }
  // 鐞嗚涓婃瀬涓嶅彲鑳藉埌杈炬澶勶紙30^6 鈮?7.29 浜跨粍鍚堬級
  throw new Error('Failed to allocate a unique seq after maximum retries');
}
