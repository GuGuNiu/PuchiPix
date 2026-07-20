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
 *
 * @param outputPath - Output MP4 File path
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
