import prisma from '@/lib/db/prisma';
import type { TaskExecutor } from '@/lib/core/orchestrator/task/executor';
import type {
  SchedulableNode,
  ExecutionContext,
  NodeExecutionResult,
  NodeProgress,
  TaskPhase,
} from '@/types/dag';

class GalleryFinalizeExecutor implements TaskExecutor {
  readonly key = 'gallery:finalize';
  readonly supportedPhases: TaskPhase[] = ['finalize'];

  private progress = new Map<string, NodeProgress>();

  async execute(
    node: SchedulableNode,
    context: ExecutionContext,
  ): Promise<NodeExecutionResult> {
    const config = node.config as { galleryId: number };
    const { galleryId } = config;

    try {
      const gallery = await prisma.gallery.findUnique({
        where: { id: galleryId },
        include: {
          _count: {
            select: {
              images: { where: { status: 'downloaded' } },
              videos: { where: { status: 'downloaded' } },
            },
          },
        },
      });

      if (!gallery) {
        return {
          success: false,
          error: {
            code: 'GALLERY_NOT_FOUND',
            message: `Gallery #${galleryId} not found`,
            retryable: false,
          },
        };
      }

      const totalImages = gallery.imageCount ?? 0;
      const totalVideos = gallery.videoCount ?? 0;
      const downloadedImages = gallery._count.images;
      const downloadedVideos = gallery._count.videos;

      const allDownloaded = downloadedImages >= totalImages && downloadedVideos >= totalVideos;

      if (allDownloaded) {
        await prisma.gallery.update({
          where: { id: galleryId },
          data: {
            status: 'completed',
            contentVerified: true,
            completedAt: new Date(),
          },
        });
      } else {
        await prisma.gallery.update({
          where: { id: galleryId },
          data: {
            status: 'partial',
            errorMsg: `${downloadedImages}/${totalImages} images, ${downloadedVideos}/${totalVideos} videos downloaded`,
          },
        });
      }

      const historyStatus = allDownloaded ? 'completed' : 'partial';
      try {
        await prisma.downloadHistory.upsert({
          where: {
            siteId_galleryId: {
              siteId: gallery.siteId,
              galleryId,
            },
          },
          create: {
            siteId: gallery.siteId,
            galleryId,
            url: gallery.sourceUrl,
            status: historyStatus,
            imageCount: downloadedImages,
            videoCount: downloadedVideos,
            title: gallery.title,
            protagonist: gallery.protagonist,
            savePath: gallery.savePath,
          },
          update: {
            status: historyStatus,
            imageCount: downloadedImages,
            videoCount: downloadedVideos,
            title: gallery.title,
            protagonist: gallery.protagonist,
            savePath: gallery.savePath,
          },
        });
      } catch {
      }

      context.onProgress({
        nodeId: node.nodeId,
        phase: node.phase,
        current: 1,
        total: 1,
      });

      return {
        success: true,
        data: {
          galleryId,
          status: allDownloaded ? 'completed' : 'partial',
          downloadedImages,
          downloadedVideos,
          totalImages,
          totalVideos,
        },
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: {
          code: 'FINALIZE_ERROR',
          message: errMsg,
          retryable: true,
        },
      };
    }
  }

  async cancel(_nodeId: string): Promise<void> {
  }

  getProgress(nodeId: string): NodeProgress | null {
    return this.progress.get(nodeId) || null;
  }
}

export const galleryFinalizeExecutor = new GalleryFinalizeExecutor();
