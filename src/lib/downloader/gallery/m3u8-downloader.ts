import fs from 'fs';
import { taskQueueManager } from '@/lib/core/orchestrator/task/queue-manager';
import { fetchM3U8Content, parseM3U8 } from '../m3u8-parser';
import type { M3U8Segment } from '../m3u8-parser';
import { downloadSegment, generateTSID } from '../segment-downloader';
import { mergeSegments, verifySegments, cleanupSegments } from '../merger';
import { transcodeTS } from '@/lib/transcoder';
import { ensureDir } from './utils';


export async function downloadM3U8Video(
  m3u8Url: string,
  outputPath: string,
  referer?: string,
): Promise<boolean> {
  const segDir = outputPath + '_segments';
  ensureDir(segDir);

  try {
    const m3u8Content = await fetchM3U8Content(m3u8Url, referer);
    const playlist = parseM3U8(m3u8Content, m3u8Url);

    let segments: M3U8Segment[];

    if (playlist.isMaster && playlist.variants.length > 0) {
      const sorted = [...playlist.variants].sort((a, b) => b.bandwidth - a.bandwidth);
      const variantUrl = sorted[0].fullURI;
      const variantContent = await fetchM3U8Content(variantUrl, referer);
      const variantPlaylist = parseM3U8(variantContent, variantUrl);
      segments = variantPlaylist.segments;
    } else {
      segments = playlist.segments;
    }

    if (segments.length === 0) {
      console.error(`[GalleryDL] M3U8 has no segments: ${m3u8Url}`);
      return false;
    }

    const concurrency = taskQueueManager.getDownloadConcurrency().tsSegmentConcurrent;
    let segIndex = 0;
    const segResults: { success: boolean; error?: Error }[] = [];

    const runSeg = async (): Promise<void> => {
      while (segIndex < segments.length) {
        const seg = segments[segIndex++];
        const tsid = generateTSID(seg.uri, seg.index);
        const result = await downloadSegment(
          { segment: seg, destDir: segDir, tsid, referer },
          5,
        );
        segResults.push({ success: !result.error, error: result.error });
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, segments.length) }, () => runSeg()),
    );

    const failedCount = segResults.filter((r) => !r.success).length;
    if (failedCount > 0) {
      console.error(`[GalleryDL] M3U8 download failed: ${failedCount}/${segments.length} segments failed`);
      return false;
    }

    const verification = verifySegments(segDir, segments.length);
    if (!verification.valid) {
      console.error(`[GalleryDL] M3U8 segment verification failed: expected ${segments.length}, actual ${verification.actualCount}`);
      return false;
    }

    const tsOutputPath = outputPath.replace(/\.\w+$/, '.ts');
    await mergeSegments(segDir, tsOutputPath);
    await transcodeTS(segDir, outputPath);

    try { fs.unlinkSync(tsOutputPath); } catch {}
    await cleanupSegments(segDir).catch(() => {});

    return true;
  } catch (err) {
    console.error(`[GalleryDL] M3U8 download error: ${m3u8Url}`, err);
    await cleanupSegments(segDir).catch(() => {});
    return false;
  }
}
