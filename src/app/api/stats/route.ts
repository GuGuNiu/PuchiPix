import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

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

    // 平均速度（按已完成任务近似估算）
    const avgSpeed = completedTasks > 0 ? totalSize / completedTasks : 0;
    const currentSpeed = 0; // 实时速度需要单独追踪
    const speedRating = completedTasks > 0 ? (totalSize / completedTasks / (1024 * 1024)) * 10 : 0;

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
    });
  } catch {
    return NextResponse.json({ error: 'Failed to get stats' }, { status: 500 });
  }
}