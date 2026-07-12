/**
 * 端到端测试：ZIP 下载闭环
 *
 * 测试流程：
 * 1. 从数据库读取图库的 ZIP 下载信息
 * 2. 调用 downloadAndExtractZip 执行完整下载链路
 *    - ouo.io 两步点击解析
 *    - MediaFire 直链提取
 *    - 流式下载 ZIP 文件
 *    - 密码解压
 * 3. 验证解压结果
 *
 * 注意：不进行 ouo.io 预检查，避免重复访问触发 IP 限速
 *
 * 使用方式:
 *   npx tsx test/e2e-zip-download.ts [galleryId]
 *   npx tsx test/e2e-zip-download.ts 10
 *
 * @date 2026-07-12
 * @lastModified 2026-07-12
 */

import fs from 'fs';
import path from 'path';
import prisma from '../src/lib/db/prisma';
import { downloadAndExtractZip } from '../src/lib/downloader/zip-downloader';

const GALLERY_ID = parseInt(process.argv[2] || '10');

async function main() {
  console.log(`\n========== ZIP 下载端到端测试 ==========`);
  console.log(`图库 ID: #${GALLERY_ID}`);
  console.log(`时间: ${new Date().toISOString()}`);

  const gallery = await prisma.gallery.findUnique({
    where: { id: GALLERY_ID },
    include: { downloadInfo: true },
  });

  if (!gallery) {
    console.error(`图库 #${GALLERY_ID} 不存在`);
    process.exit(1);
  }

  console.log(`\n图库信息:`);
  console.log(`  标题: ${gallery.title}`);
  console.log(`  主角: ${gallery.protagonist || 'N/A'}`);
  console.log(`  来源URL: ${gallery.sourceUrl}`);

  if (!gallery.downloadInfo) {
    console.error('该图库无 ZIP 下载信息');
    process.exit(1);
  }

  const di = gallery.downloadInfo;
  console.log(`\nZIP 下载信息:`);
  console.log(`  下载URL: ${di.downloadUrl}`);
  console.log(`  提供商: ${di.provider}`);
  console.log(`  密码: ${di.password || 'N/A'}`);
  console.log(`  文件数: ${di.fileCount}`);
  console.log(`  体积: ${di.fileSizeText}`);
  console.log(`  当前状态: ${di.status}`);
  console.log(`  需要登录: ${di.requiresLogin}`);

  if (!di.downloadUrl || di.downloadUrl.includes('/auth/login')) {
    console.error('下载 URL 无效（需要登录），无法测试');
    process.exit(1);
  }

  // 重置状态为 available，确保从头开始
  if (di.status === 'failed' || di.status === 'downloading') {
    console.log(`\n重置状态: ${di.status} → available`);
    await prisma.galleryDownloadInfo.update({
      where: { galleryId: GALLERY_ID },
      data: { status: 'available' },
    });
  }

  // 直接执行下载（不做预检查，避免触发 ouo.io IP 限速）
  console.log('\n========== 开始 ZIP 下载 ==========');
  console.log(`开始时间: ${new Date().toISOString()}`);

  const result = await downloadAndExtractZip(GALLERY_ID);

  console.log(`\n========== 下载结果 ==========`);
  console.log(`结束时间: ${new Date().toISOString()}`);
  console.log(`成功: ${result.success}`);
  console.log(`状态: ${result.status}`);
  console.log(`本地路径: ${result.localPath || 'N/A'}`);
  console.log(`解压路径: ${result.extractedPath || 'N/A'}`);
  console.log(`文件大小: ${result.actualSize} bytes (${(result.actualSize / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`文件数量: ${result.fileCount}`);
  if (result.error) {
    console.log(`错误: ${result.error}`);
  }

  // 验证解压结果
  if (result.success && result.extractedPath) {
    console.log('\n========== 验证解压结果 ==========');
    const extractDir = result.extractedPath;
    if (fs.existsSync(extractDir)) {
      const entries = fs.readdirSync(extractDir, { recursive: true });
      const files = entries.filter((e) => {
        const fullPath = path.join(extractDir, e.toString());
        return fs.statSync(fullPath).isFile();
      });
      console.log(`解压目录: ${extractDir}`);
      console.log(`实际文件数: ${files.length}`);
      console.log(`前 10 个文件:`);
      files.slice(0, 10).forEach((f, i) => {
        const fullPath = path.join(extractDir, f.toString());
        const size = fs.statSync(fullPath).size;
        console.log(`  ${i + 1}. ${f} (${(size / 1024).toFixed(1)} KB)`);
      });
    } else {
      console.log(`解压目录不存在: ${extractDir}`);
    }
  }

  await prisma.$disconnect();
  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
