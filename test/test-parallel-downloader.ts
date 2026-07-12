/**
 * 多线程分块下载器独立测试
 *
 * 使用公开的测试文件验证 HTTP Range 请求和并行下载功能。
 *
 * @date 2026-07-12
 */

import fs from 'fs';
import path from 'path';
import { parallelDownload } from '../src/lib/downloader/parallel-downloader';

const TEST_URL = 'https://proof.ovh.net/files/10Mb.dat';
const TEST_PATH = './data/test_parallel_download.bin';

async function main() {
  console.log('========== 多线程分块下载器测试 ==========');
  console.log(`URL: ${TEST_URL}`);
  console.log(`保存路径: ${TEST_PATH}`);
  console.log(`期望大小: 100 MB`);
  console.log(`时间: ${new Date().toISOString()}\n`);

  // 确保目录存在
  const dir = path.dirname(TEST_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 清理旧文件
  if (fs.existsSync(TEST_PATH)) {
    fs.unlinkSync(TEST_PATH);
  }

  // 测试 4 线程
  console.log('--- 测试 1：4 线程并行下载 ---');
  const start1 = Date.now();
  const result1 = await parallelDownload(TEST_URL, TEST_PATH, {
    chunkCount: 4,
    onProgress: (downloaded, total) => {
      if (total > 0 && downloaded % (20 * 1024 * 1024) < 1024 * 1024) {
        const pct = Math.round((downloaded / total) * 100);
        console.log(`  进度: ${pct}% (${(downloaded / 1024 / 1024).toFixed(0)} MB)`);
      }
    },
  });
  const elapsed1 = (Date.now() - start1) / 1000;
  const speed1 = result1.fileSize > 0 ? (result1.fileSize / 1024 / 1024 / elapsed1).toFixed(1) : '0';

  console.log(`\n结果:`);
  console.log(`  成功: ${result1.success}`);
  console.log(`  文件大小: ${result1.fileSize} bytes`);
  console.log(`  使用并行: ${result1.parallelism} 线程`);
  console.log(`  Range 支持: ${result1.ranged}`);
  console.log(`  耗时: ${elapsed1.toFixed(1)} 秒`);
  console.log(`  平均速度: ${speed1} MB/s (${(result1.avgSpeed / 1024).toFixed(0)} KB/s)`);
  console.log(`  保存路径: ${result1.savedPath}`);

  if (result1.success) {
    console.log('\n✅ 多线程下载测试通过');
  } else {
    console.log('\n❌ 多线程下载测试失败');
  }

  // 清理
  if (fs.existsSync(TEST_PATH)) {
    fs.unlinkSync(TEST_PATH);
  }

  process.exit(result1.success ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
