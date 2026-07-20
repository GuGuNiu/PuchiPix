import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';

const adapter = new PrismaLibSql({
  url: process.env.DATABASE_URL || 'file:./data/puchipix.db',
});
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  // Check what URLs these DAGs point to and if other galleries exist with same URL
  const urls = [
    'https://www.lovecutes.net/article/28339', // gallery-256 (cancelled), 257, 258
    'https://xx.knit.bid/article/15480',        // gallery-261
    'https://www.lovecutes.net/article/28615',  // gallery-325
  ];

  for (const url of urls) {
    const galleries = await prisma.gallery.findMany({
      where: { sourceUrl: { contains: url.replace('https://', '').replace('http://', '') } },
      select: { id: true, sourceUrl: true, status: true, title: true, imageCount: true },
    });
    console.log(`\nURL: ${url}`);
    for (const g of galleries) {
      console.log(`  #${g.id}: status=${g.status} img=${g.imageCount} title="${g.title?.substring(0, 40)}" url=${g.sourceUrl}`);
    }
    if (galleries.length === 0) {
      console.log('  (no galleries found)');
    }
  }

  // Also check #325 specifically
  const g325 = await prisma.gallery.findUnique({
    where: { id: 325 },
    select: { id: true, sourceUrl: true, status: true, title: true, imageCount: true, videoCount: true, savePath: true },
  });
  console.log(`\n#325 detail:`, g325);

  // Check #298 missing files
  const g298 = await prisma.gallery.findUnique({
    where: { id: 298 },
    select: { id: true, sourceUrl: true, status: true, imageCount: true, savePath: true },
  });
  console.log(`\n#298 detail:`, g298);

  const missingImgs = await prisma.galleryImage.findMany({
    where: { galleryId: 298, status: { not: 'downloaded' } },
    select: { id: true, url: true, status: true, localPath: true },
  });
  console.log(`#298 missing images (${missingImgs.length}):`);
  for (const img of missingImgs) {
    console.log(`  img #${img.id}: status=${img.status} url=${img.url?.substring(0, 80)}`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
