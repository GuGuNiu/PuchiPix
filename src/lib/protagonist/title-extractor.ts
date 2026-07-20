import {
  cleanTitlePrefix,
  isAIGenerated,
  looksLikePersonName,
  isLikelyPersonName,
  isTagInFirstSegment,
  NON_PERSON_TAGS,
} from './utils';

export interface TitleExtractorDeps {
  matchKnownPerson(text: string, excludeGameCharacters?: boolean): string | null;
  fuzzyMatchPerson(name: string, threshold?: number, excludeGameCharacters?: boolean): string | null;
  matchGameCharacterInText(text: string): Promise<string | null>;
  isGameCharacter(name: string): Promise<boolean>;
}


export async function extractFromTitleSmart(
  title: string,
  tags: string[],
  deps: TitleExtractorDeps,
): Promise<string> {
  if (!title) return '';

  const cleanedTitle = cleanTitlePrefix(title);

  const personFromTags = await extractPersonFromTags(cleanedTitle, tags, deps);
  if (personFromTags) return personFromTags;

  const knownPerson = deps.matchKnownPerson(cleanedTitle);
  if (knownPerson) return knownPerson;

  if (isAIGenerated(cleanedTitle)) return '';

  const gameChar = await deps.matchGameCharacterInText(cleanedTitle);
  if (gameChar) {
    const cosplayerFromSeparator = extractCosplayerBeforeChar(cleanedTitle, gameChar, deps);
    if (cosplayerFromSeparator) return cosplayerFromSeparator;
    return '';
  }

  const bracketResult = await extractFromBrackets(cleanedTitle, deps);
  if (bracketResult) return bracketResult;

  const standardResult = await extractStandardFormat(cleanedTitle, tags, deps);
  if (standardResult) return standardResult;

  for (const tag of tags) {
    if (tag.length > 1 && tag.length < 20 && cleanedTitle.startsWith(tag)) {
      return tag;
    }
  }

  return '';
}


async function extractPersonFromTags(
  title: string,
  tags: string[],
  deps: TitleExtractorDeps,
): Promise<string | null> {
  if (!tags || tags.length === 0) return null;

  for (const tag of tags) {
    if (NON_PERSON_TAGS.has(tag)) continue;
    if (tag.length < 2 || tag.length > 20) continue;
    if (await deps.isGameCharacter(tag)) continue;

    if (title.startsWith(tag)) {
      if (looksLikePersonName(tag)) return tag;
    }

    const parenMatch = title.match(/^([a-zA-Z0-9]+)\s*\(([^)]+)\)/);
    if (parenMatch) {
      const englishName = parenMatch[1];
      const chineseName = parenMatch[2];
      if (chineseName === tag && looksLikePersonName(englishName)) {
        return englishName;
      }
    }
  }

  for (const tag of tags) {
    if (NON_PERSON_TAGS.has(tag)) continue;
    if (await deps.isGameCharacter(tag)) continue;
    const knownPerson = deps.matchKnownPerson(tag);
    if (knownPerson) return knownPerson;
  }

  for (const tag of tags) {
    if (NON_PERSON_TAGS.has(tag)) continue;
    if (tag.length < 2 || tag.length > 20) continue;
    if (await deps.isGameCharacter(tag)) continue;

    if (looksLikePersonName(tag)) {
      if (isTagInFirstSegment(title, tag)) {
        return tag;
      }
    }
  }

  return null;
}


function extractCosplayerBeforeChar(
  title: string,
  gameCharName: string,
  deps: TitleExtractorDeps,
): string | null {
  const charIndex = title.indexOf(gameCharName);
  if (charIndex <= 0) return null;

  const beforeChar = title.substring(0, charIndex).trim();
  if (beforeChar.length === 0) return null;

  const separatorMatch = beforeChar.match(/^(.+?)\s*[-—–:]\s*/);
  if (!separatorMatch) {
    const candidate = beforeChar.replace(/[(][^)]*[)]$/, '').trim();
    if (candidate.length >= 2 && candidate.length <= 25) {
      if (isLikelyPersonName(candidate)) return candidate;
    }
    return null;
  }

  let candidate = separatorMatch[1].trim();
  candidate = candidate.replace(/[(][^)]*[)]$/, '').trim();
  candidate = candidate.replace(/^[\s\-—–:]+|[\s\-—–:]+$/g, '');

  if (candidate.length < 2 || candidate.length > 25) return null;

  const knownPerson = deps.matchKnownPerson(candidate);
  if (knownPerson) return knownPerson;

  const fuzzyMatch = deps.fuzzyMatchPerson(candidate);
  if (fuzzyMatch) return fuzzyMatch;

  if (isLikelyPersonName(candidate)) return candidate;

  return null;
}


async function extractFromBrackets(
  title: string,
  deps: TitleExtractorDeps,
): Promise<string | null> {
  const bracketMatch = title.match(/[『「【\[]([^」」】\]]+)[」】\]]/);
  if (!bracketMatch) return null;

  const bracketContent = bracketMatch[1];
  const segments = bracketContent.split(/\s*[-—–]\s*/);

  for (const seg of segments) {
    const candidate = seg.trim();
    if (!candidate || candidate.length < 2 || candidate.length > 20) continue;

    const person = deps.matchKnownPerson(candidate);
    if (person) return person;

    if (await deps.isGameCharacter(candidate)) continue;

    const fuzzyMatch = deps.fuzzyMatchPerson(candidate);
    if (fuzzyMatch) return fuzzyMatch;

    if (looksLikePersonName(candidate)) return candidate;
  }

  return null;
}


async function extractStandardFormat(
  title: string,
  tags: string[],
  deps: TitleExtractorDeps,
): Promise<string | null> {
  const parts = title.split(/\s*[-—–]\s*/).filter((p) => p.length > 0);
  if (parts.length < 2) return null;

  const candidate = parts[0].trim();
  if (!candidate || candidate.length >= 25) return null;

  if (/[『「【\[]$/.test(candidate)) return null;

  if (tags.some((tag) => tag === candidate || tag === candidate.replace(/^[^\u4e00-\u9fff]+/, ''))) {
    return candidate;
  }

  if (await deps.isGameCharacter(candidate)) return null;

  const person = deps.matchKnownPerson(candidate);
  if (person) return person;

  const fuzzyMatch = deps.fuzzyMatchPerson(candidate);
  if (fuzzyMatch) return fuzzyMatch;

  if (looksLikePersonName(candidate)) return candidate;

  const englishNameMatch = candidate.match(/^([a-zA-Z][a-zA-Z0-9]*)(?:\s*[(]([^)]+)[)])?$/);
  if (englishNameMatch) {
    const englishName = englishNameMatch[1];
    const chineseName = englishNameMatch[2];

    if (englishName.length >= 2 && englishName.length <= 20) {
      if (chineseName && tags.some(tag => tag.includes(chineseName))) {
        return candidate;
      }
      if (!chineseName && /^[a-zA-Z][a-zA-Z0-9]*$/.test(englishName)) {
        const restOfTitle = parts.slice(1).join(' - ');
        if (await deps.matchGameCharacterInText(restOfTitle) ||
            /^(原神|星穹铁道|崩坏|碧蓝航线|碧蓝档案|鸣潮|火影忍者|电锯人|葬送的芙莉莲|明日方舟|绝区零)/.test(restOfTitle)) {
          return candidate;
        }
      }
    }
  }

  return null;
}
