import fs from 'fs';
import path from 'path';
import prisma from '@/lib/db/prisma';
import { getOrCreateGlobal } from '../infra/global-singleton';
import { NodeState, type VerificationResult } from '@/types/dag';
import type { TaskStateMachine } from './task-state-machine';

export interface DagNodeForVerification {
  nodeId: string;
  dagId: string;
  state: NodeState;
  phase: string;
  config: Record<string, unknown>;
  fsm: TaskStateMachine;
}

class StateReconciler {
  /**
   * 鏍￠獙鍗曚釜鑺傜偣鐨勪骇鍑虹墿
   */
  async verifyNode(node: DagNodeForVerification): Promise<VerificationResult> {
    if (node.state !== NodeState.VERIFYING) {
      return { status: 'skipped', corrected: 0, reason: 'not in verifying state' };
    }

    switch (node.phase) {
      case 'scrape':
        return this.verifyScrapeNode(node);
      case 'download':
        return this.verifyDownloadNode(node);
      default:
        return { status: 'passed', corrected: 0, reason: 'no verification needed' };
    }
  }

  /**
   * 鏍￠獙璇嗗埆鑺傜偣 鈥?妫€鏌?DB 涓槸鍚︽湁鍥剧墖/瑙嗛璁板綍
   */
  private async verifyScrapeNode(node: DagNodeForVerification): Promise<VerificationResult> {
    const galleryId = node.config.galleryId as number;
    if (!galleryId) {
      return { status: 'passed', corrected: 0, reason: 'no galleryId in config' };
    }

    const imageCount = await prisma.galleryImage.count({ where: { galleryId } });
    const videoCount = await prisma.galleryVideo.count({ where: { galleryId } });

    if (imageCount === 0 && videoCount === 0) {
      return {
        status: 'failed',
        corrected: 0,
        reason: '璇嗗埆瀹屾垚浣嗘湭鎵惧埌浠讳綍鍥剧墖鎴栬棰戣褰?,
      };
    }

    return { status: 'passed', corrected: 0, reason: `璇嗗埆楠岃瘉閫氳繃: ${imageCount} 鍥剧墖, ${videoCount} 瑙嗛` };
  }

  /**
   * 鏍￠獙涓嬭浇鑺傜偣 鈥?浠ユ枃浠剁郴缁熶负鐪熺浉婧?
   */
  private async verifyDownloadNode(node: DagNodeForVerification): Promise<VerificationResult> {
    const galleryId = node.config.galleryId as number;
    if (!galleryId) {
      return { status: 'passed', corrected: 0, reason: 'no galleryId in config' };
    }

    const gallery = await prisma.gallery.findUnique({
      where: { id: galleryId },
      include: {
        images: { orderBy: { orderIndex: 'asc' } },
        videos: { orderBy: { id: 'asc' } },
      },
    });

    if (!gallery) {
      return { status: 'failed', corrected: 0, reason: `鍥惧簱 #${galleryId} 涓嶅瓨鍦╜ };
    }

    let allPresent = true;
    let corrected = 0;

    // 鏍￠獙鍥剧墖
    for (const img of gallery.images) {
      if (img.localPath && fs.existsSync(img.localPath)) {
        // 鏂囦欢瀛樺湪 鈫?濡傛灉 DB 鐘舵€佷笉鏄?downloaded锛屼慨姝ｅ畠
        if (img.status !== 'downloaded') {
          const stat = fs.statSync(img.localPath);
          await prisma.galleryImage.update({
            where: { id: img.id },
            data: {
              status: 'downloaded',
              fileSize: BigInt(stat.size),
              completedAt: new Date(),
            },
          });
          corrected++;
        }
      } else {
        // 鏂囦欢涓嶅瓨鍦?鈫?濡傛灉 DB 鐘舵€佹槸 downloaded锛屼慨姝ｄ负 pending
        if (img.status === 'downloaded') {
          await prisma.galleryImage.update({
            where: { id: img.id },
            data: {
              status: 'pending',
              localPath: '',
              fileSize: BigInt(0),
              completedAt: null,
            },
          });
          corrected++;
        }
        allPresent = false;
      }
    }

    // 鏍￠獙瑙嗛
    for (const vid of gallery.videos) {
      if (vid.localPath && fs.existsSync(vid.localPath)) {
        if (vid.status !== 'downloaded') {
          const stat = fs.statSync(vid.localPath);
          await prisma.galleryVideo.update({
            where: { id: vid.id },
            data: {
              status: 'downloaded',
              fileSize: BigInt(stat.size),
              completedAt: new Date(),
            },
          });
          corrected++;
        }
      } else {
        if (vid.status === 'downloaded') {
          await prisma.galleryVideo.update({
            where: { id: vid.id },
            data: {
              status: 'pending',
              localPath: '',
              fileSize: BigInt(0),
              completedAt: null,
            },
          });
          corrected++;
        }
        allPresent = false;
      }
    }

    if (allPresent) {
      // 鏇存柊鍥惧簱鎬绘暟
      const totalSize = await this.calculateTotalSize(gallery.savePath);
      await prisma.gallery.update({
        where: { id: galleryId },
        data: {
          status: 'completed',
          contentVerified: true,
          totalSize: BigInt(totalSize),
          completedAt: new Date(),
        },
      });
      return { status: 'passed', corrected, reason: 'all files verified' };
    } else {
      return { status: 'failed', corrected, reason: 'some files missing' };
    }
  }

  /**
   * 璁＄畻鏂囦欢澶规€诲ぇ灏?
   */
  private calculateTotalSize(dirPath: string): number {
    if (!dirPath || !fs.existsSync(dirPath)) return 0;
    let totalSize = 0;
    const walk = (dir: string): void => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath);
        } else {
          totalSize += stat.size;
        }
      }
    };
    try {
      walk(dirPath);
    } catch {
      // ignore
    }
    return totalSize;
  }
}

export const stateReconciler = getOrCreateGlobal(
  '__puchipix_state_reconciler__',
  () => new StateReconciler(),
);
