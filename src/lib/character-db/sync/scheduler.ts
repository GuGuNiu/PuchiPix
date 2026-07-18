/**
 * 角色数据库同步调度器
 *
 * 负责从 BWiki 同步角色数据。当前通过 API 端点（POST /api/character-db/sync）手动触发，
 * 定时任务尚未实现。
 *
 * @todo 接入 cron 调度库以支持 enableCron / cronExpression 配置项，实现自动定时同步
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CharacterDBIndex, GameIndexEntry, SyncLog, GameSyncResult, SyncError, GameCharacterFile } from '../types';
import { getBWikiCrawler } from '../crawlers/bwiki-crawler';

export interface SchedulerConfig {
  /** 数据库基础路径 */
  dbPath: string;
  /** 是否启用定时任务（尚未实现，当前仅支持手动触发） */
  enableCron: boolean;
  /** 定时表达式 (cron格式，尚未实现） */
  cronExpression: string;
}

export class CharacterDBScheduler {
  private config: SchedulerConfig;
  private isRunning = false;

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = {
      dbPath: path.join(process.cwd(), 'src', 'lib', 'character-db'),
      enableCron: true,
      cronExpression: '0 3 * * 1', // 每周一凌晨3点
      ...config,
    };
  }

  /**
   * 手动触发同步
   */
  async runSync(specificGames?: string[]): Promise<SyncLog> {
    if (this.isRunning) {
      throw new Error('[CharacterDBScheduler] 同步任务正在运行中');
    }

    this.isRunning = true;
    const startTime = new Date();

    const syncLog: SyncLog = {
      startedAt: startTime.toISOString(),
      games: [],
      errors: [],
    };

    try {
      console.log('[CharacterDBScheduler] 开始同步任务');

      const index = await this.loadIndex();

      const gamesToSync = specificGames
        ? index.games.filter(g => specificGames.includes(g.id) && g.enabled)
        : index.games.filter(g => g.enabled);

      console.log(`[CharacterDBScheduler] 将同步 ${gamesToSync.length} 个游戏`);

      for (const game of gamesToSync) {
        try {
          const result = await this.syncGame(game);
          syncLog.games.push(result);
        } catch (err) {
          console.error(`[CharacterDBScheduler] 同步失败: ${game.id}`, err);
          syncLog.errors.push({
            gameId: game.id,
            error: String(err),
          });
        }
      }

      await this.updateIndexStats(index);

      syncLog.completedAt = new Date().toISOString();
      await this.saveSyncLog(syncLog);

      console.log('[CharacterDBScheduler] 同步任务完成');
    } catch (err) {
      console.error('[CharacterDBScheduler] 同步任务异常:', err);
      syncLog.errors.push({
        gameId: 'system',
        error: String(err),
      });
    } finally {
      this.isRunning = false;
    }

    return syncLog;
  }

  /**
   * 同步单个游戏
   */
  private async syncGame(game: GameIndexEntry): Promise<GameSyncResult> {
    console.log(`[CharacterDBScheduler] 同步游戏: ${game.name}`);

    const crawler = getBWikiCrawler();
    const gameFile = await crawler.crawlGame(game);

    // 读取现有数据用于对比
    const existingFile = await this.loadGameFile(game);

    const changes = this.calculateChanges(existingFile?.characters || [], gameFile.characters);

    await this.saveGameFile(game, gameFile);

    game.characterCount = gameFile.characters.length;
    game.lastSync = new Date().toISOString();

    console.log(`[CharacterDBScheduler] ${game.name} 同步完成: +${changes.added} -${changes.removed} ~${changes.modified}`);

    return {
      gameId: game.id,
      added: changes.added,
      removed: changes.removed,
      modified: changes.modified,
    };
  }

  /**
   * 计算数据变更
   */
  private calculateChanges(
    oldChars: { id: string; name: string }[],
    newChars: { id: string; name: string }[]
  ): { added: number; removed: number; modified: number } {
    const oldMap = new Map(oldChars.map(c => [c.id, c]));
    const newMap = new Map(newChars.map(c => [c.id, c]));

    let added = 0;
    let removed = 0;
    let modified = 0;

    for (const [id, char] of newMap) {
      if (!oldMap.has(id)) {
        added++;
      } else if (JSON.stringify(oldMap.get(id)) !== JSON.stringify(char)) {
        modified++;
      }
    }

    for (const id of oldMap.keys()) {
      if (!newMap.has(id)) {
        removed++;
      }
    }

    return { added, removed, modified };
  }

  /**
   * 加载索引
   */
  private async loadIndex(): Promise<CharacterDBIndex> {
    const indexPath = path.join(this.config.dbPath, 'index.json');
    const content = await fs.promises.readFile(indexPath, 'utf-8');
    return JSON.parse(content) as CharacterDBIndex;
  }

  /**
   * 保存索引
   */
  private async saveIndex(index: CharacterDBIndex): Promise<void> {
    const indexPath = path.join(this.config.dbPath, 'index.json');
    await fs.promises.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  }

  /**
   * 更新索引统计
   */
  private async updateIndexStats(index: CharacterDBIndex): Promise<void> {
    index.lastUpdated = new Date().toISOString();
    index.stats = {
      totalGames: index.games.length,
      totalCharacters: index.games.reduce((sum, g) => sum + g.characterCount, 0),
      totalGamesEnabled: index.games.filter(g => g.enabled).length,
    };
    await this.saveIndex(index);
  }

  /**
   * 加载游戏文件
   */
  private async loadGameFile(game: GameIndexEntry) {
    try {
      const filePath = path.join(this.config.dbPath, game.file);
      if (!fs.existsSync(filePath)) return null;
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(content) as GameCharacterFile;
    } catch {
      return null;
    }
  }

  /**
   * 保存游戏文件
   */
  private async saveGameFile(game: GameIndexEntry, data: unknown): Promise<void> {
    const filePath = path.join(this.config.dbPath, game.file);
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * 保存同步日志
   */
  private async saveSyncLog(log: SyncLog): Promise<void> {
    const logDir = path.join(this.config.dbPath, 'cache', 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logPath = path.join(logDir, `sync-${log.startedAt.replace(/[:.]/g, '-')}.json`);
    await fs.promises.writeFile(logPath, JSON.stringify(log, null, 2), 'utf-8');
  }

  /**
   * 检查是否正在运行
   */
  isSyncRunning(): boolean {
    return this.isRunning;
  }
}

// 导出单例
let scheduler: CharacterDBScheduler | null = null;

export function getCharacterDBScheduler(config?: Partial<SchedulerConfig>): CharacterDBScheduler {
  if (!scheduler) {
    scheduler = new CharacterDBScheduler(config);
  }
  return scheduler;
}
