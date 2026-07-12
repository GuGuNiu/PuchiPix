/**
 * ffmpeg.ts — FFmpeg 视频转码工具
 *
 * 职责：
 * 1. 将 TS 分片合并并转码为 MP4 格式（使用 FFmpeg concat demuxer）。
 * 2. 探测视频文件的时长和分辨率。
 * 3. 检查系统中是否安装了 FFmpeg。
 *
 * 转码策略：
 * - 使用 FFmpeg 的 concat demuxer（-f concat -safe 0）。
 * - 默认使用流拷贝（-c copy），不重新编码，速度最快。
 * - 如果 TS 文件编码不兼容 MP4 容器，可能需要重新编码（暂未实现，可按需添加）。
 *
 * 前置要求：
 * - 系统需安装 FFmpeg 并可在 PATH 中找到，或通过 setFFmpegPath() 指定路径。
 */

import { exec, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// FFmpeg 路径配置
// ============================================================

/** FFmpeg 可执行文件路径，默认从 PATH 中查找 */
let ffmpegPath = 'ffmpeg';

/**
 * 设置 FFmpeg 可执行文件路径。
 * 在 Windows 上可指定如 "C:\\ffmpeg\\bin\\ffmpeg.exe"。
 *
 * @param p - FFmpeg 可执行文件路径
 */
export function setFFmpegPath(p: string): void {
  ffmpegPath = p;
}

/**
 * 检查系统中是否安装了 FFmpeg。
 *
 * @returns true 如果 FFmpeg 可用
 */
export function checkFFmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    exec(`"${ffmpegPath}" -version`, (error) => {
      resolve(!error);
    });
  });
}

// ============================================================
// TS 转 MP4 转码
// ============================================================

/**
 * 将 TS 分片目录中的所有分片合并并转码为 MP4 文件。
 *
 * 流程：
 * 1. 读取分片目录中所有 .ts 文件。
 * 2. 按序号排序，生成 FFmpeg concat 格式的文件列表。
 * 3. 调用 FFmpeg 使用 concat demuxer 进行流拷贝转码。
 * 4. 清理临时 concat 文件。
 *
 * concat 文件格式示例：
 * ```
 * file '/path/to/segment_00000.ts'
 * file '/path/to/segment_00001.ts'
 * file '/path/to/segment_00002.ts'
 * ```
 *
 * @param inputDir   - TS 分片所在目录
 * @param outputPath - 输出 MP4 文件路径
 * @throws 如果无分片文件或 FFmpeg 转码失败
 */
export async function transcodeTS(inputDir: string, outputPath: string): Promise<void> {
  const dirPath = path.resolve(inputDir);

  // 1. 读取并排序分片文件
  const files = fs
    .readdirSync(dirPath)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.tmp'))
    .sort((a, b) => {
      const idxA = parseInt(a.match(/_(\d+)\.ts$/)?.[1] || '0', 10);
      const idxB = parseInt(b.match(/_(\d+)\.ts$/)?.[1] || '0', 10);
      return idxA - idxB;
    });

  if (files.length === 0) {
    throw new Error('No .ts segment files found for transcoding');
  }

  // 2. 生成 concat 文件（FFmpeg concat demuxer 需要的输入格式）
  const concatPath = path.join(dirPath, 'concat.txt');
  const concatContent = files
    .map((f) => `file '${path.join(dirPath, f).replace(/\\/g, '/')}'`)
    .join('\n');
  fs.writeFileSync(concatPath, concatContent, 'utf-8');

  // 3. 确保输出目录存在
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 4. 构建 FFmpeg 命令参数
  const outputResolved = path.resolve(outputPath);
  const concatResolved = path.resolve(concatPath);

  const args = [
    '-f', 'concat',         // 使用 concat demuxer
    '-safe', '0',           // 允许绝对路径（默认不允许，会报错）
    '-i', concatResolved,   // 输入文件列表
    '-c', 'copy',           // 流拷贝（不重新编码，速度最快）
    '-bsf:a', 'aac_adtstoasc', // 音频比特流过滤器（TS 的 ADTS 头转 MP4 需要）
    '-y',                   // 覆盖输出文件
    outputResolved,
  ];

  // 5. 执行 FFmpeg 转码
  return new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // 收集 stderr 输出（FFmpeg 的日志输出在 stderr）
    let stderr = '';
    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // 进程结束
    proc.on('close', (code) => {
      // 清理临时 concat 文件
      try {
        fs.unlinkSync(concatPath);
      } catch {
        // 忽略清理错误
      }

      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      }
    });

    // 进程错误
    proc.on('error', (err) => {
      try {
        fs.unlinkSync(concatPath);
      } catch {
        // 忽略清理错误
      }
      reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
    });
  });
}

// ============================================================
// 视频信息探测
// ============================================================

/**
 * 探测视频文件的时长。
 *
 * 使用 FFmpeg 的 -i 参数解析文件信息，从 stderr 输出中提取 Duration 字段。
 * 格式: Duration: 00:21:10.30
 *
 * @param filePath - 视频文件路径
 * @returns 时长（秒），解析失败返回 0
 */
export function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    exec(
      `"${ffmpegPath}" -i "${filePath}" 2>&1`,
      { timeout: 15000 },
      (error, stdout, stderr) => {
        const output = stderr || stdout;
        // 匹配 Duration: HH:MM:SS.xx
        const match = output.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
        if (match) {
          const hours = parseInt(match[1], 10);
          const minutes = parseInt(match[2], 10);
          const seconds = parseInt(match[3], 10);
          const ms = parseInt(match[4], 10);
          resolve(hours * 3600 + minutes * 60 + seconds + ms / 100);
        } else {
          resolve(0);
        }
      }
    );
  });
}

/**
 * 探测视频文件的分辨率。
 *
 * 从 FFmpeg 输出中匹配 WxH 格式的分辨率字符串。
 * 格式: 1280x720
 *
 * @param filePath - 视频文件路径
 * @returns 分辨率字符串（如 "1280x720"），解析失败返回空字符串
 */
export function probeResolution(filePath: string): Promise<string> {
  return new Promise((resolve) => {
    exec(
      `"${ffmpegPath}" -i "${filePath}" 2>&1`,
      { timeout: 15000 },
      (error, stdout, stderr) => {
        const output = stderr || stdout;
        // 匹配 WxH 格式的分辨率（宽和高均为 2~4 位数字）
        const match = output.match(/(\d{2,4}x\d{2,4})/);
        if (match) {
          resolve(match[1]);
        } else {
          resolve('');
        }
      }
    );
  });
}
