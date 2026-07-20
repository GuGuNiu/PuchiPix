import prisma from '@/lib/db/prisma';
import { eventBus } from '@/lib/core/infra/event-bus';
import { allocateSeq } from '@/lib/core/orchestrator/seq-allocator';
import { normalizeUrl, cleanUrl } from '@/lib/utils/url-normalizer';
import { checkGalleryDuplicate } from '@/lib/utils/task-dedup';
import type { TaskExecutor } from '@/lib/core/orchestrator/task/executor';
import type {
  SchedulableNode,
  ExecutionContext,
  NodeExecutionResult,
  NodeProgress,
  TaskPhase,
} from '@/types/dag';

class GalleryCreateExecutor implements TaskExecutor {
  readonly key = 'gallery:create';
  readonly supportedPhases: TaskPhase[] = ['create'];

  private progress = new Map<string, NodeProgress>();

  async execute(
    node: SchedulableNode,
    context: ExecutionContext,
  ): Promise<NodeExecutionResult> {
    const config = node.config as {
      url: string;
      providerId: string;
      galleryId?: number;
    };

    const rawUrl = config.url;
    const url = cleanUrl(rawUrl);
    const normalizedUrl = normalizeUrl(url);

    try {
      const dedupResult = await checkGalleryDuplicate(url);
      if (dedupResult.duplicate && dedupResult.recordId) {
        const existing = await prisma.gallery.findUnique({
          where: { id: dedupResult.recordId },
        });

        if (existing) {
          return {
            success: true,
            data: {
              galleryId: existing.id,
              duplicate: true,
              matchType: dedupResult.matchType,
              existingStatus: existing.status,
              existingTitle: existing.title,
            },
          };
        }
      }

      const seq = await allocateSeq();
      const providerId = config.providerId;

      const gallery = await prisma.gallery.upsert({
        where: { sourceUrl: normalizedUrl },
        create: {
          sourceUrl: normalizedUrl,
          siteId: providerId,
          status: 'pending',
          seq,
        },
        update: {},
      });

      eventBus.emit('gallery:scrapeStarted', { galleryId: gallery.id, url });

      context.onProgress({
        nodeId: node.nodeId,
        phase: node.phase,
        current: 1,
        total: 1,
      });

      return {
        success: true,
        data: {
          galleryId: gallery.id,
          seq: gallery.seq ?? seq,
          duplicate: false,
        },
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: {
          code: 'CREATE_FAILED',
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

export const galleryCreateExecutor = new GalleryCreateExecutor();
