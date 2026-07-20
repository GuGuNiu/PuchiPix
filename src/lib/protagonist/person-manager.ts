import prisma from '@/lib/db/prisma';
import { getCharacterDBServiceAsync } from '@/lib/character-db';
import type { ProtagonistParseResult, ProtagonistStats } from './index';
import { toStandardPinyin, calculateSimilarity, parseMixedName } from './utils';

export interface PersonCacheEntry {
  name: string;
  pinyin: string;
  aliases: string[];
  galleryCount: number;
  source: string;
}

export interface PersonManagerDeps {
  personCache: Map<string, PersonCacheEntry>;
  pinyinCache: Map<string, PersonCacheEntry>;
  toStandardPinyin(name: string): string;
  fuzzyMatchPerson(name: string, threshold?: number, excludeGameCharacters?: boolean): string | null;
  isGameCharacter(name: string): Promise<boolean>;
}

export async function learnPerson(
  name: string,
  source: string,
  deps: PersonManagerDeps,
): Promise<void> {
  if (!name) return;

  if (await deps.isGameCharacter(name)) return;

  const exactEntry = deps.personCache.get(name.toLowerCase());
  if (exactEntry) {
    try {
      await prisma.person.update({
        where: { name: exactEntry.name },
        data: {
          galleryCount: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      exactEntry.galleryCount++;
    } catch (err) {
      console.warn(`[ProtagonistService] learnPerson exact match update failed: ${name}`, err);
    }
    return;
  }

  const fuzzyName = deps.fuzzyMatchPerson(name, 0.85);
  if (fuzzyName) {
    try {
      const existing = await prisma.person.findUnique({ where: { name: fuzzyName } });
      if (existing) {
        let aliases: string[] = [];
        try {
          aliases = JSON.parse(existing.aliases) as string[];
        } catch {
          aliases = [];
        }
        if (!aliases.includes(name)) {
          aliases.push(name);
        }
        await prisma.person.update({
          where: { name: fuzzyName },
          data: {
            aliases: JSON.stringify(aliases),
            galleryCount: { increment: 1 },
            updatedAt: new Date(),
          },
        });
        const cacheEntry = deps.personCache.get(fuzzyName.toLowerCase());
        if (cacheEntry) {
          if (!cacheEntry.aliases.includes(name)) {
            cacheEntry.aliases.push(name);
          }
          cacheEntry.galleryCount++;
        }
      }
    } catch (err) {
      console.warn(`[ProtagonistService] learnPerson pinyin fuzzy match update failed: ${name} → ${fuzzyName}`, err);
    }
    return;
  }

  try {
    const py = deps.toStandardPinyin(name);
    await prisma.person.create({
      data: {
        name,
        pinyin: py,
        aliases: '[]',
        source,
        galleryCount: 1,
        confirmed: false,
      },
    });
    const entry: PersonCacheEntry = { name, pinyin: py, aliases: [], galleryCount: 1, source };
    deps.personCache.set(name.toLowerCase(), entry);
    if (py) {
      deps.pinyinCache.set(py, entry);
    }
  } catch (err) {
    if (!String(err).includes('Unique constraint')) {
      console.warn(`[ProtagonistService] learnPerson create failed: ${name}`, err);
    }
  }
}

export async function importGameCharacters(
  toPinyin: (name: string) => string,
  refreshCache: () => Promise<void>,
): Promise<number> {
  const db = await getCharacterDBServiceAsync();
  const allChars = db
    .getAllCharacters()
    .filter((c: { category: string }) => c.category === 'game');
  let imported = 0;

  for (const char of allChars) {
    try {
      const py = toPinyin(char.name);
      const aliasesJson = JSON.stringify(char.aliases || []);
      await prisma.person.upsert({
        where: { name: char.name },
        create: {
          name: char.name,
          pinyin: py,
          aliases: aliasesJson,
          source: 'game_character',
          sourceGame: char.gameId,
          galleryCount: 0,
          confirmed: true,
        },
        update: {
          pinyin: py,
          aliases: aliasesJson,
          sourceGame: char.gameId,
        },
      });
      imported++;
    } catch (err) {
      console.warn(`[ProtagonistService] Failed to import game character: ${char.name}`, err);
    }
  }

  await refreshCache();
  console.log(`[ProtagonistService] Successfully imported ${imported} game characters to Person table`);
  return imported;
}

export async function normalizeFromDatabase(rawName: string): Promise<ProtagonistParseResult> {
  if (!rawName) {
    return {
      rawName: '',
      standardName: '',
      chinesePart: '',
      pinyinPart: '',
      isMixedName: false,
      confidence: 0,
      matchedAliases: [],
    };
  }

  const parsed = parseMixedName(rawName);
  const allGalleries = await prisma.gallery.findMany({
    where: { protagonist: { not: '' } },
    select: { protagonist: true },
    distinct: ['protagonist'],
  });

  const allNames = allGalleries.map((g) => g.protagonist);
  const similarNames: { name: string; similarity: number }[] = [];

  for (const name of allNames) {
    const sim = calculateSimilarity(rawName, name);
    if (sim > 0.6) {
      similarNames.push({ name, similarity: sim });
    }
  }

  similarNames.sort((a, b) => b.similarity - a.similarity);

  const nameCounts: { [key: string]: number } = {};
  for (const { name } of similarNames) {
    nameCounts[name] = await prisma.gallery.count({
      where: { protagonist: name },
    });
  }

  let standardName = rawName;
  let maxCount = 0;
  for (const { name } of similarNames) {
    const count = nameCounts[name];
    if (count > maxCount) {
      maxCount = count;
      standardName = name;
    }
  }

  if (similarNames.length === 0) {
    standardName = parsed.chinese || rawName;
  }

  return {
    rawName,
    standardName,
    chinesePart: parsed.chinese,
    pinyinPart: parsed.pinyin,
    isMixedName: parsed.isMixed,
    confidence: similarNames.length > 0 ? similarNames[0].similarity : 1,
    matchedAliases: similarNames.map((s) => s.name),
  };
}

export async function getProtagonistStats(standardName: string): Promise<ProtagonistStats | null> {
  if (!standardName) return null;

  const galleries = await prisma.gallery.findMany({
    where: { protagonist: standardName },
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, coverUrl: true },
  });

  if (galleries.length === 0) return null;

  const allGalleries = await prisma.gallery.findMany({
    where: { protagonist: { not: '' } },
    select: { protagonist: true },
  });

  const aliasCounts: { [key: string]: number } = {};
  for (const g of allGalleries) {
    const sim = calculateSimilarity(standardName, g.protagonist);
    if (sim > 0.6 && g.protagonist !== standardName) {
      aliasCounts[g.protagonist] = (aliasCounts[g.protagonist] || 0) + 1;
    }
  }

  const aliases = Object.entries(aliasCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return {
    standardName,
    count: galleries.length,
    aliases,
    galleries: galleries.map((g) => ({
      id: g.id,
      title: g.title,
      coverUrl: g.coverUrl,
    })),
  };
}

export async function getAllProtagonists(): Promise<{ name: string; count: number; coverUrl: string }[]> {
  const result = await prisma.gallery.groupBy({
    by: ['protagonist'],
    where: { protagonist: { not: '' } },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  });

  const protagonists = [];
  for (const item of result) {
    const latest = await prisma.gallery.findFirst({
      where: { protagonist: item.protagonist },
      orderBy: { createdAt: 'desc' },
      select: { coverUrl: true },
    });

    protagonists.push({
      name: item.protagonist,
      count: item._count.id,
      coverUrl: latest?.coverUrl || '',
    });
  }

  return protagonists;
}
