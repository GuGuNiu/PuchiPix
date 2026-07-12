/**
 * 查询数据库中图库的 ZIP 下载信息状态
 *
 * @date 2026-07-12
 */

import prisma from '../src/lib/db/prisma';

async function main() {
  const galleries = await prisma.gallery.findMany({
    include: { downloadInfo: true },
    take: 30,
    orderBy: { id: 'desc' },
  });

  console.log(`\n=== 共 ${galleries.length} 个图库 ===\n`);

  for (const g of galleries) {
    const di = g.downloadInfo;
    console.log(
      `#${g.id} | ${(g.title || '').substring(0, 50)}`,
    );
    if (di) {
      console.log(
        `  ZIP: url=${(di.downloadUrl || 'N/A').substring(0, 80)}`,
      );
      console.log(
        `  status=${di.status} | pwd=${di.password || 'N/A'} | provider=${di.provider || 'N/A'} | files=${di.fileCount}`,
      );
      console.log(
        `  localPath=${di.localPath || 'N/A'} | extractedPath=${di.extractedPath || 'N/A'}`,
      );
    } else {
      console.log('  ZIP: 无下载信息');
    }
    console.log('');
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
