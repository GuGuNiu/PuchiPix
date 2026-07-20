import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { formatFileSize } from '@/lib/utils';
import os from 'os';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  try {
    const [totalTasks, completedTasks, failedTasks, downloadingTasks, videoInfos] =
      await Promise.all([
        prisma.downloadTask.count(),
        prisma.downloadTask.count({ where: { status: 'completed' } }),
        prisma.downloadTask.count({ where: { status: 'failed' } }),
        prisma.downloadTask.count({ where: { status: 'downloading' } }),
        prisma.videoInfo.findMany({ select: { fileSize: true } }),
      ]);

    const totalSize = videoInfos.reduce((sum: number, v: { fileSize: bigint | number }) => sum + Number(v.fileSize), 0);

    const avgSpeed = completedTasks > 0 ? totalSize / completedTasks : 0;
    const currentSpeed = 0; // Real-time speed needs separate tracking
    const speedRating = completedTasks > 0 ? (totalSize / completedTasks / (1024 * 1024)) * 10 : 0;

    let diskIoBytesPerSec = 0;
    try {
      const diskInfo = (os as unknown as { getDiskUsage?: () => { readSpeed?: number; writeSpeed?: number }; diskUsage?: () => { readSpeed?: number; writeSpeed?: number } }).getDiskUsage?.() || (os as unknown as { getDiskUsage?: () => { readSpeed?: number; writeSpeed?: number }; diskUsage?: () => { readSpeed?: number; writeSpeed?: number } }).diskUsage?.();
      if (diskInfo && typeof diskInfo === 'object') {
        diskIoBytesPerSec = diskInfo.readSpeed || diskInfo.writeSpeed || 0;
      }
    } catch {
    }
    const diskIoStr = formatFileSize(diskIoBytesPerSec) + '/s';

    return NextResponse.json({
      total_tasks: totalTasks,
      completed_tasks: completedTasks,
      failed_tasks: failedTasks,
      downloading_tasks: downloadingTasks,
      total_size: totalSize,
      total_size_str: formatFileSize(totalSize),
      avg_speed: Math.round(avgSpeed),
      avg_speed_str: formatFileSize(avgSpeed) + '/task',
      current_speed: currentSpeed,
      current_speed_str: formatFileSize(currentSpeed) + '/s',
      speed_rating: Math.round(speedRating),
      disk_io_str: diskIoStr,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to get stats' }, { status: 500 });
  }
}