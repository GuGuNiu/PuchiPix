﻿﻿﻿﻿﻿/**﻿﻿﻿﻿/ * ﻿/ ** RoledatalibrarySyncscheduler﻿﻿/ **﻿﻿﻿﻿/ * ﻿/ **﻿﻿﻿﻿/ * ﻿/ *﻿﻿/ * ﻿/ ﻿﻿/ * ﻿/ ﻿﻿/ * ﻿/ ﻿﻿/ * ﻿/ ﻿﻿/ * ﻿/ ﻿﻿/ * ﻿/ ﻿﻿/ * ﻿/ ﻿﻿﻿﻿/ * ﻿/ ﻿﻿﻿﻿/ * ﻿/ ﻿﻿﻿﻿/ * ﻿/ ﻿﻿﻿﻿/ * ﻿/ ﻿﻿﻿﻿/ * ﻿/ ﻿﻿﻿﻿/ * ﻿/ ﻿﻿﻿﻿/ * ﻿/ ﻿﻿﻿﻿/ * ﻿/ ﻿﻿﻿﻿/ * ﻿/ ﻿﻿﻿﻿/ * ﻿/ 
﻿﻿﻿﻿/ 
﻿﻿﻿﻿/ */

import * as fs from 'fs';
import * as path from 'path';
import type { CharacterDBIndex, GameIndexEntry, SyncLog, GameSyncResult, SyncError, GameCharacterFile } from './types';
import { getBWikiCrawler } from './crawlers/bwiki-crawler';

export interface SchedulerConfig {
  /** DatalibrarybasePath */
  dbPath: string;
  enableCron: boolean;
  cronExpression: string;
}

export class CharacterDBScheduler {
  private config: SchedulerConfig;
  private isRunning = false;

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = {
      dbPath: path.join(process.cwd(), 'src', 'lib', 'character-db'),
      enableCron: true,
      cronExpression: '0 3 * * 1', // Every Monday 3 AM
      ...config,
    };
  }

  async runSync(specificGames?: string[]): Promise<SyncLog> {
    if (this.isRunning) {
      throw new Error('[CharacterDBScheduler] Sync task is already running');
    }

    this.isRunning = true;
    const startTime = new Date();

    const syncLog: SyncLog = {
      startedAt: startTime.toISOString(),
      games: [],
      errors: [],
    };

    try {
      console.log('[CharacterDBScheduler] Sync task started');

      const index = await this.loadIndex();

      const gamesToSync = specificGames
        ? index.games.filter(g => specificGames.includes(g.id) && g.enabled)
        : index.games.filter(g => g.enabled);

      console.log(`[CharacterDBScheduler] Will sync ${gamesToSync.length} games`);

      for (const game of gamesToSync) {
        try {
          const result = await this.syncGame(game);
          syncLog.games.push(result);
        } catch (err) {
          console.error(`[CharacterDBScheduler] Sync failed: ${game.id}`, err);
          syncLog.errors.push({
            gameId: game.id,
            error: String(err),
          });
        }
      }

      await this.updateIndexStats(index);

      syncLog.completedAt = new Date().toISOString();
      await this.saveSyncLog(syncLog);

      console.log('[CharacterDBScheduler] Sync task completed');
    } catch (err) {
      console.error('[CharacterDBScheduler] Sync task error:', err);
      syncLog.errors.push({
        gameId: 'system',
        error: String(err),
      });
    } finally {
      this.isRunning = false;
    }

    return syncLog;
  }

  private async syncGame(game: GameIndexEntry): Promise<GameSyncResult> {
    console.log(`[CharacterDBScheduler] Syncing game: ${game.name}`);

    const crawler = getBWikiCrawler();
    const gameFile = await crawler.crawlGame(game);

    const existingFile = await this.loadGameFile(game);

    const changes = this.calculateChanges(existingFile?.characters || [], gameFile.characters);

    await this.saveGameFile(game, gameFile);

    game.characterCount = gameFile.characters.length;
    game.lastSync = new Date().toISOString();

    console.log(`[CharacterDBScheduler] ${game.name} sync completed: +${changes.added} -${changes.removed} ~${changes.modified}`);

    return {
      gameId: game.id,
      added: changes.added,
      removed: changes.removed,
      modified: changes.modified,
    };
  }

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

  private async loadIndex(): Promise<CharacterDBIndex> {
    const indexPath = path.join(this.config.dbPath, 'index.json');
    const content = await fs.promises.readFile(indexPath, 'utf-8');
    return JSON.parse(content) as CharacterDBIndex;
  }

  private async saveIndex(index: CharacterDBIndex): Promise<void> {
    const indexPath = path.join(this.config.dbPath, 'index.json');
    await fs.promises.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  }

  private async updateIndexStats(index: CharacterDBIndex): Promise<void> {
    index.lastUpdated = new Date().toISOString();
    index.stats = {
      totalGames: index.games.length,
      totalCharacters: index.games.reduce((sum, g) => sum + g.characterCount, 0),
      totalGamesEnabled: index.games.filter(g => g.enabled).length,
    };
    await this.saveIndex(index);
  }

  private async loadGameFile(game: GameIndexEntry): Promise<GameCharacterFile | null> {
    try {
      const filePath = path.join(this.config.dbPath, game.file);
      if (!fs.existsSync(filePath)) return null;
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(content) as GameCharacterFile;
    } catch {
      return null;
    }
  }

  private async saveGameFile(game: GameIndexEntry, data: unknown): Promise<void> {
    const filePath = path.join(this.config.dbPath, game.file);
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private async saveSyncLog(log: SyncLog): Promise<void> {
    const logDir = path.join(this.config.dbPath, 'cache', 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logPath = path.join(logDir, `sync-${log.startedAt.replace(/[:.]/g, '-')}.json`);
    await fs.promises.writeFile(logPath, JSON.stringify(log, null, 2), 'utf-8');
  }

  isSyncRunning(): boolean {
    return this.isRunning;
  }
}

let scheduler: CharacterDBScheduler | null = null;

export function getCharacterDBScheduler(config?: Partial<SchedulerConfig>): CharacterDBScheduler {
  if (!scheduler) {
    scheduler = new CharacterDBScheduler(config);
  }
  return scheduler;
}
