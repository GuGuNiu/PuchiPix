import fs from 'fs';
import path from 'path';
import prisma from '@/lib/db/prisma';
import { getOrCreateGlobal } from '../infra/global-singleton';
import { NodeState, type VerificationResult } from '@/types/dag';
import type { TaskStateMachine } from './task/state-machine';

export interface DagNodeForVerification {
  nodeId: string;
  dagId: string;
  state: NodeState;
  phase: string;
  config: Record<string, unknown>;
  fsm: TaskStateMachine;
}

class StateReconciler {

  async verifyNode(node: DagNodeForVerification): Promise<VerificationResult> {
    if (node.state === NodeState.RESUME_VERIFY) {
      await node.fsm.transition(
        NodeState.VERIFYING,
        { reason: 'resume verify from checkpoint', triggeredBy: 'system' },
      );
    } else if (node.state !== NodeState.VERIFYING) {
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

  private async verifyScrapeNode(node: DagNodeForVerification): Promise<VerificationResult> {
    const galleryId = node.config.galleryId as number;
    if (!galleryId) {
      return { status: 'passed', corrected: 0, reason: 'no galleryId in config' };
    }

    const imageCount = await prisma.galleryImage.count({ where: { galleryId } });
    const videoCount = await prisma.galleryVideo.count({ where: { galleryId } });

    if (imageCount === 0 && videoCount === 0) {
      /*
       * DB has no image/video records — scrape was likely interrupted before
       * saving results. Return needs_retry to trigger automatic re-scrape
       * instead of hard-failing the node.
       */
      return {
        status: 'needs_retry',
        corrected: 0,
        reason: 'scrape was interrupted before saving data, re-scrape needed',
      };
    }

    return { status: 'passed', corrected: 0, reason: `图片 ${imageCount} 个, 视频 ${videoCount} 个` };
  }

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
      return { status: 'failed', corrected: 0, reason: `图包 #${galleryId} 不存在` };
    }

    let allPresent = true;
    let corrected = 0;

    for (const img of gallery.images) {
      if (img.localPath && fs.existsSync(img.localPath)) {
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
    }
    return totalSize;
  }
}

export const stateReconciler = getOrCreateGlobal(
  '__puchipix_state_reconciler__',
  () => new StateReconciler(),
);
