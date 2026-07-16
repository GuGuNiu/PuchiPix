/**
 * 统一工具模块导出
 *
 * 所有基础工具函数从这里统一导出，方便使用：
 * @example
 * import { parseFileSize, formatFileSize, sleep, retry, sanitizeFilename } from '@/lib/utils';
 */

// 文件大小处理
export {
  parseFileSize,
  formatFileSize,
  formatFileSizePrecise,
  compareFileSizes,
} from './file-size';

// 延迟与计时
export {
  sleep,
  randomDelay,
  sleepRandom,
  withTimeout,
  retry,
  exponentialBackoff,
} from './delay';

// URL 处理
export {
  cleanUrl,
  normalizeUrl,
  getUrlPath,
  getUrlSignature,
  generateMirrorUrls,
  getAllSiteDomains,
  extractDomain,
} from './url-normalizer';

// 文件名处理
export {
  sanitizeFilename,
  extractFilenameFromHeaders,
  extractFilenameFromUrl,
} from './filename';

// 字符串处理
export {
  replaceDomain,
  decodeHtmlEntities,
  cleanText,
  truncate,
} from './string';

// 格式化
export {
  formatDuration,
  formatTime,
  formatDate,
  formatNumber,
} from './format';

// 文件系统操作（仅服务端使用，不统一导出以避免客户端打包 fs）
// import {
//   safeDeleteFile,
//   safeDeleteDir,
//   safeDeletePaths,
//   hasDeleteFailures,
//   summarizeDeleteResults,
//   type DeleteResult,
// } from './safe-delete';
// 需要时直接 import from '@/lib/utils/safe-delete'

// 任务去重
export {
  checkGalleryDuplicate,
  checkVideoTaskDuplicate,
  checkTaskDuplicate,
  type DedupResult,
} from './task-dedup';
