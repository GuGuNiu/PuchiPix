import prisma from '@/lib/db/prisma';
import { eventBus } from '@/lib/core/infra/event-bus';
import { getGalleryDownloader } from '@/lib/downloader/gallery';
import type { TaskExecutor } from '@/lib/core/orchestrator/task/executor';
import type {
  SchedulableNode,
  ExecutionContext,
  NodeExecutionResult,
  NodeProgress,
  TaskPhase,
} from '@/types/dag';

class GalleryDownloadExecutor implements TaskExecutor {
  readonly key = 'gallery:download';
  readonly supportedPhases: TaskPhase[] = ['download'];

  private progress = new Map<string, NodeProgress>();
  private cancelled = new Set<string>();

  async execute(
    node: SchedulableNode,
    context: ExecutionContext,
  ): Promise<NodeExecutionResult> {
    const config = node.config as { galleryId: number };
    const { galleryId } = config;

    try {
      const gallery = await prisma.gallery.findUnique({ where: { id: galleryId } });
      if (!gallery) {
        return {
          success: false,
          error: {
            code: 'GALLERY_NOT_FOUND',
            message: `图包 #${galleryId} 不存在`,
            retryable: false,
          },
        };
      }

      if (gallery.status === 'completed' || gallery.status === 'not_found') {
        return { success: true, data: { galleryId, skipped: true } };
      }

      await prisma.gallery.update({
        where: { id: galleryId },
        data: { status: 'downloading' },
      });

      eventBus.emit('gallery:downloadStarted', {
        galleryId,
        total: gallery.imageCount + gallery.videoCount,
      });

      const downloader = getGalleryDownloader();
      const result = await downloader.downloadGallery(galleryId);

      context.onProgress({
        nodeId: node.nodeId,
        phase: node.phase,
        current: result.success,
        total: result.success + result.failed,
        failed: result.failed,
      });

      if (result.failed > 0 && result.success === 0) {
        return {
          success: false,
          error: {
            code: 'DOWNLOAD_FAILED',
            message: `全部 ${result.failed} 个文件下载失败`,
            retryable: true,
          },
        };
      }

      return {
        success: true,
        data: {
          galleryId,
          success: result.success,
          failed: result.failed,
          skipped: result.skipped,
        },
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      eventBus.emit('gallery:downloadFailed', { galleryId, error: errMsg });
      return {
        success: false,
        error: {
          code: 'DOWNLOAD_ERROR',
          message: errMsg,
          retryable: true,
        },
      };
    }
  }

  async cancel(nodeId: string): Promise<void> {
    this.cancelled.add(nodeId);
    const galleryId = parseInt(nodeId.replace('gallery-', ''), 10);
    if (!isNaN(galleryId)) {
      try {
        getGalleryDownloader().cancelDownload(galleryId);
      } catch {
      }
    }
  }

  getProgress(nodeId: string): NodeProgress | null {
    return this.progress.get(nodeId) || null;
  }
}

export const galleryDownloadExecutor = new GalleryDownloadExecutor();
