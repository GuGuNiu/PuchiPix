/**
 * 测试 RAR 解压功能
 *
 * 使用已下载的 RAR 文件测试 node-unrar-js 解压
 *
 * @date 2026-07-12
 */

import fs from 'fs';
import path from 'path';
import { createExtractorFromFile } from 'node-unrar-js';

async function main() {
  const zipDir = 'data/gallery_zips/gallery_10';
  const files = fs.readdirSync(zipDir);
  const rarFile = files.find((f) => f.endsWith('.rar'));

  if (!rarFile) {
    console.error('未找到 RAR 文件');
    process.exit(1);
  }

  const rarPath = path.join(zipDir, rarFile);
  const extractPath = path.join(zipDir, 'test_extract');

  console.log(`RAR 文件: ${rarPath}`);
  console.log(`文件大小: ${fs.statSync(rarPath).size} bytes`);
  console.log(`解压目标: ${extractPath}`);

  fs.mkdirSync(extractPath, { recursive: true });

  const password = 'www.lovecutes.com';
  console.log(`密码: ${password}`);

  console.log('\n开始解压...');
  const startTime = Date.now();

  try {
    const extractor = await createExtractorFromFile({
      filepath: rarPath,
      targetPath: extractPath,
      password,
    });

    const extracted = extractor.extract({ password });
    const fileList: string[] = [];

    for (const file of extracted.files) {
      if (!file.fileHeader.flags.directory) {
        fileList.push(file.fileHeader.name);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n解压成功！耗时: ${elapsed}s`);
    console.log(`文件数量: ${fileList.length}`);

    console.log('\n前 15 个文件:');
    fileList.slice(0, 15).forEach((f, i) => {
      console.log(`  ${i + 1}. ${f}`);
    });

    // 验证解压结果
    const actualFiles = fs.readdirSync(extractPath, { recursive: true });
    const realFiles = actualFiles.filter((f) => {
      const fullPath = path.join(extractPath, f.toString());
      return fs.statSync(fullPath).isFile();
    });
    console.log(`\n实际解压文件数: ${realFiles.length}`);
  } catch (err) {
    console.error('解压失败:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
