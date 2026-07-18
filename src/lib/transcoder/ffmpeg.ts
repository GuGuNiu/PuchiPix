import { exec, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ensureDir } from '@/lib/utils/file-system';

let ffmpegPath = 'ffmpeg';

export function setFFmpegPath(p: string): void {
  ffmpegPath = p;
}

export function checkFFmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    exec(`"${ffmpegPath}" -version`, (error) => {
      resolve(!error);
    });
  });
}

/**
 * 将 TS 分片目录中的所有分片合并并转码为 MP4 文件。
 *
 * @param inputDir   - TS 分片所在目录
 * @param outputPath - 输出 MP4 文件路径
 * @throws 如果无分片文件或 FFmpeg 转码失败
 */
export async function transcodeTS(inputDir: string, outputPath: string): Promise<void> {
  const dirPath = path.resolve(inputDir);

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

  const concatPath = path.join(dirPath, 'concat.txt');
  const concatContent = files
    .map((f) => `file '${path.join(dirPath, f).replace(/\\/g, '/')}'`)
    .join('\n');
  fs.writeFileSync(concatPath, concatContent, 'utf-8');

  ensureDir(path.dirname(outputPath));

  const outputResolved = path.resolve(outputPath);
  const concatResolved = path.resolve(concatPath);

  /**
   * FFmpeg concat 参数说明：
   * - `-f concat`：使用 concat demuxer
   * - `-safe 0`：允许绝对路径（默认不允许，会报错）
   * - `-c copy`：流拷贝（不重新编码，速度最快）
   * - `-bsf:a aac_adtstoasc`：TS 的 ADTS 头转 MP4 需要
   * - `-y`：覆盖输出文件
   */
  const args = [
    '-f', 'concat',
    '-safe', '0',
    '-i', concatResolved,
    '-c', 'copy',
    '-bsf:a', 'aac_adtstoasc',
    '-y',
    outputResolved,
  ];

  return new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // 收集 stderr 输出（FFmpeg 的日志输出在 stderr）
    let stderr = '';
    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      try {
        fs.unlinkSync(concatPath);
      } catch {
      }

      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      }
    });

    proc.on('error', (err) => {
      try {
        fs.unlinkSync(concatPath);
      } catch {
      }
      reject(new Error(`Failed to spawn FFmpeg: ${err instanceof Error ? err.message : String(err)}`));
    });
  });
}

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

export function probeResolution(filePath: string): Promise<string> {
  return new Promise((resolve) => {
    exec(
      `"${ffmpegPath}" -i "${filePath}" 2>&1`,
      { timeout: 15000 },
      (error, stdout, stderr) => {
        const output = stderr || stdout;
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
