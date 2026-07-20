import { getPinyinService } from '@/lib/core/pinyin-service';
import {
  cleanTitlePrefix,
  isAIGenerated,
  parseMixedName,
  stripCosplayerPrefix,
  isCategoryKeyword,
  NON_PERSON_TAGS,
} from './utils';
import type { TitleExtractorDeps } from './title-extractor';


export type CandidateSource =
  | 'tag-exact'        // Tag exact match on title prefix
  | 'tag-fuzzy'        // Tag fuzzy match
  | 'known-person'     // Person DB known person substring match
  | 'dash-separator'   // First segment after dash separator
  | 'colon-after'      // Content after colon
  | 'bracket-content'  // Content inside brackets
  | 'coser-prefix'     // Name after Coser/Cos prefix
  | 'first-word'       // First word when no separator found
  | 'game-char-before' // Cosplayer before game character name
  | 'english-name'     // Pure English name pattern
  | 'pipe-separator'   // Pipe separator
  ;

export interface Candidate {
  name: string;
  source: CandidateSource;
  rawText: string;
  position: number;
  sourceConfidence: number;
}

export interface ScoredCandidate extends Candidate {
  score: number;
  scoreBreakdown: ScoreBreakdown;
}

export interface ScoreBreakdown {
  nameFeature: number;
  patternMatch: number;
  tagCorrelation: number;
  knownPerson: number;
  historicalFrequency: number;
  negativeIndicator: number;
}

export interface AdaptiveExtractionResult {
  name: string;
  confidence: number;
  source: CandidateSource;
  scoreBreakdown: ScoreBreakdown;
  allCandidates: ScoredCandidate[];
}



export class PatternModel {
  private sampleCount = 0;

  private lengthHistogram: Map<number, number> = new Map();

  private compositionStats = {
    pureChinese: 0,
    pureEnglish: 0,
    mixed: 0,
    withDigits: 0,
  };

  private separatorFrequency: Map<string, number> = new Map();

  private nameFrequency: Map<string, number> = new Map();

  private knownNames: Set<string> = new Set();

  private knownPinyins: Map<string, string> = new Map();

  private blacklist: Set<string> = new Set();

  private tagPersonCooccurrence: Map<string, Set<string>> = new Map();

  private tagFrequency: Map<string, number> = new Map();

  private tagAsPersonCount: Map<string, number> = new Map();

  private sourceHitRate: Map<CandidateSource, { hits: number; total: number }> = new Map();

  
  learn(title: string, protagonist: string, tags: string[] = []): void {
    if (!protagonist || !title) return;

    this.sampleCount++;

    const len = protagonist.length;
    this.lengthHistogram.set(len, (this.lengthHistogram.get(len) || 0) + 1);

    const parsed = parseMixedName(protagonist);
    if (parsed.isMixed) {
      this.compositionStats.mixed++;
    } else if (parsed.chinese && !parsed.pinyin) {
      this.compositionStats.pureChinese++;
    } else if (!parsed.chinese && parsed.pinyin) {
      this.compositionStats.pureEnglish++;
    }
    if (/\d/.test(protagonist)) {
      this.compositionStats.withDigits++;
    }

    const cleaned = cleanTitlePrefix(title);
    if (cleaned.includes(' - ')) {
      this.separatorFrequency.set('dash', (this.separatorFrequency.get('dash') || 0) + 1);
    }
    if (cleaned.includes('：') || cleaned.includes(':')) {
      this.separatorFrequency.set('colon', (this.separatorFrequency.get('colon') || 0) + 1);
    }
    if (cleaned.includes('|')) {
      this.separatorFrequency.set('pipe', (this.separatorFrequency.get('pipe') || 0) + 1);
    }

    this.nameFrequency.set(protagonist, (this.nameFrequency.get(protagonist) || 0) + 1);
    this.knownNames.add(protagonist.toLowerCase());

    const py = getPinyinService().getVariants(protagonist).full;
    if (py) {
      this.knownPinyins.set(py.toLowerCase(), protagonist);
    }

    for (const tag of tags) {
      this.tagFrequency.set(tag, (this.tagFrequency.get(tag) || 0) + 1);
      if (tag === protagonist) {
        this.tagAsPersonCount.set(tag, (this.tagAsPersonCount.get(tag) || 0) + 1);
      }
      if (!this.tagPersonCooccurrence.has(tag)) {
        this.tagPersonCooccurrence.set(tag, new Set());
      }
      this.tagPersonCooccurrence.get(tag)!.add(protagonist);
    }
  }

  
  detectFalsePositives(): string[] {
    const detected: string[] = [];

    for (const [tagName, cooccurred] of this.tagPersonCooccurrence) {
      const tagCount = this.tagFrequency.get(tagName) || 0;
      if (tagCount < 3) continue;

      if (cooccurred.size >= 3) {
        let asTitlePrefix = 0;
        for (const [name] of this.nameFrequency) {
          if (name.includes(tagName) || tagName.includes(name)) {
            asTitlePrefix++;
          }
        }

        if (asTitlePrefix === 0) {
          detected.push(tagName);
        }
      }
    }

    for (const name of detected) {
      this.blacklist.add(name);
    }

    return detected;
  }

  
  addToBlacklist(name: string): void {
    if (name) this.blacklist.add(name);
  }

  
  isBlacklisted(name: string): boolean {
    if (!name) return false;
    return this.blacklist.has(name);
  }

  
  getNameFrequency(name: string): number {
    return this.nameFrequency.get(name) || 0;
  }

  
  isKnownName(name: string): boolean {
    return this.knownNames.has(name.toLowerCase());
  }

  
  fuzzyMatchKnownName(name: string, threshold: number = 0.85): string | null {
    const py = getPinyinService().getVariants(name).full;
    if (!py) return null;

    let bestMatch: string | null = null;
    let bestSim = threshold;

    for (const [knownPy, knownName] of this.knownPinyins) {
      const sim = getPinyinService().calculateSimilarity(py, knownPy, { algorithm: 'bigram' });
      if (sim > bestSim) {
        bestSim = sim;
        bestMatch = knownName;
      }
    }

    return bestMatch;
  }

  
  getLengthProbability(length: number): number {
    if (this.sampleCount === 0) {
      if (length < 2 || length > 25) return 0.1;
      if (length >= 2 && length <= 8) return 0.9;
      if (length >= 9 && length <= 15) return 0.6;
      return 0.3;
    }

    const count = this.lengthHistogram.get(length) || 0;
    const total = this.sampleCount;
    return count / total;
  }

  
  getCompositionProbability(name: string): number {
    if (this.sampleCount === 0) {
      const parsed = parseMixedName(name);
      if (parsed.isMixed) return 0.9;
      if (parsed.chinese) return 0.85;
      if (parsed.pinyin) return 0.7;
      return 0.3;
    }

    const total = this.sampleCount;
    const parsed = parseMixedName(name);
    let prob = 0;

    if (parsed.isMixed) {
      prob = this.compositionStats.mixed / total;
    } else if (parsed.chinese && !parsed.pinyin) {
      prob = this.compositionStats.pureChinese / total;
    } else if (!parsed.chinese && parsed.pinyin) {
      prob = this.compositionStats.pureEnglish / total;
    }

    if (/\d/.test(name)) {
      prob = Math.min(prob, this.compositionStats.withDigits / total);
    }

    return prob;
  }

  
  getTagAsPersonConfidence(tag: string): number {
    const asPerson = this.tagAsPersonCount.get(tag) || 0;
    const total = this.tagFrequency.get(tag) || 0;
    if (total === 0) return 0.5; // Unknown tag, neutral confidence
    return asPerson / total;
  }

  getSourceHitRate(source: CandidateSource): number {
    const stats = this.sourceHitRate.get(source);
    if (!stats || stats.total === 0) return 0.5; // Unknown strategy, neutral
    return stats.hits / stats.total;
  }

  
  recordSourceOutcome(source: CandidateSource, hit: boolean): void {
    if (!this.sourceHitRate.has(source)) {
      this.sourceHitRate.set(source, { hits: 0, total: 0 });
    }
    const stats = this.sourceHitRate.get(source)!;
    stats.total++;
    if (hit) stats.hits++;
  }

  
  getStats(): {
    sampleCount: number;
    uniqueNames: number;
    blacklistSize: number;
    composition: { pureChinese: number; pureEnglish: number; mixed: number; withDigits: number };
  } {
    return {
      sampleCount: this.sampleCount,
      uniqueNames: this.nameFrequency.size,
      blacklistSize: this.blacklist.size,
      composition: { ...this.compositionStats },
    };
  }
}


export interface CandidateGeneratorDeps extends TitleExtractorDeps {
  patternModel: PatternModel;
}


export class CandidateGenerator {
  constructor(private deps: CandidateGeneratorDeps) {}

  
  async generate(title: string, tags: string[]): Promise<Candidate[]> {
    const candidates: Candidate[] = [];
    const cleanedTitle = cleanTitlePrefix(title);

    if (!cleanedTitle) return candidates;

    this.generateFromTagExact(cleanedTitle, tags, candidates);

    this.generateFromKnownPerson(cleanedTitle, candidates);

    this.generateFromDashSeparator(cleanedTitle, tags, candidates);

    this.generateFromColon(cleanedTitle, tags, candidates);

    this.generateFromBrackets(cleanedTitle, candidates);

    this.generateFromCoserPrefix(cleanedTitle, tags, candidates);

    this.generateFromPipe(cleanedTitle, candidates);

    await this.generateFromGameCharBefore(cleanedTitle, candidates);

    this.generateFromFirstWord(cleanedTitle, tags, candidates);

    this.generateFromTagFuzzy(cleanedTitle, tags, candidates);

    return candidates;
  }

  private generateFromTagExact(
    title: string,
    tags: string[],
    out: Candidate[],
  ): void {
    for (const tag of tags) {
      if (NON_PERSON_TAGS.has(tag)) continue;
      if (tag.length < 2 || tag.length > 20) continue;

      if (title.startsWith(tag)) {
        out.push({
          name: tag,
          source: 'tag-exact',
          rawText: tag,
          position: 0,
          sourceConfidence: 0.95,
        });
      }

      const parenMatch = title.match(/^([a-zA-Z0-9]+)\s*\(([^)]+)\)/);
      if (parenMatch) {
        const englishName = parenMatch[1];
        const chineseName = parenMatch[2];
        if (chineseName === tag) {
          out.push({
            name: englishName,
            source: 'tag-exact',
            rawText: englishName,
            position: 0,
            sourceConfidence: 0.9,
          });
        }
      }
    }
  }

  private generateFromKnownPerson(title: string, out: Candidate[]): void {
    const known = this.deps.matchKnownPerson(title, true);
    if (known) {
      const pos = title.toLowerCase().indexOf(known.toLowerCase());
      out.push({
        name: known,
        source: 'known-person',
        rawText: known,
        position: pos >= 0 ? pos : 0,
        sourceConfidence: 0.85,
      });
    }
  }

  private generateFromDashSeparator(
    title: string,
    tags: string[],
    out: Candidate[],
  ): void {
    const parts = title.split(/\s*[-—–]\s*/).filter((p) => p.length > 0);
    if (parts.length < 2) return;

    const first = parts[0].trim();
    if (!first || first.length < 2 || first.length > 25) return;

    const colonInFirst = first.match(/^[^：:]+[：:]\s*(.+)$/);
    if (colonInFirst) {
      const afterColon = colonInFirst[1].trim();
      if (afterColon.length >= 2 && afterColon.length <= 20) {
        const beforeColon = first.match(/^([^：:]+)[：:]/);
        if (beforeColon && isCategoryKeyword(beforeColon[1])) {
          out.push({
            name: afterColon,
            source: 'colon-after',
            rawText: afterColon,
            position: title.indexOf(afterColon),
            sourceConfidence: 0.85,
          });
          return;
        }
      }
    }

    out.push({
      name: first,
      source: 'dash-separator',
      rawText: first,
      position: 0,
      sourceConfidence: 0.8,
    });
  }

  private generateFromColon(
    title: string,
    tags: string[],
    out: Candidate[],
  ): void {
    const colonMatch = title.match(/^([^：:]+)[：:]\s*(.+)/);
    if (!colonMatch) return;

    const beforeColon = colonMatch[1].trim();
    const afterColon = colonMatch[2].trim();

    if (isCategoryKeyword(beforeColon)) {
      const subParts = afterColon.split(/\s*[-—–]\s*/).filter((p) => p.length > 0);
      if (subParts.length >= 1) {
        const candidate = subParts[0].trim();
        if (candidate.length >= 2 && candidate.length <= 25) {
          out.push({
            name: candidate,
            source: 'colon-after',
            rawText: candidate,
            position: title.indexOf(candidate),
            sourceConfidence: 0.8,
          });
        }
      }
      return;
    }

    if (/^(?:Coser|coser|Cos|cos|COS|COSER)\b/i.test(beforeColon)) {
      const stripped = stripCosplayerPrefix(beforeColon).trim();
      if (stripped.length >= 2 && stripped.length <= 20) {
        out.push({
          name: stripped,
          source: 'coser-prefix',
          rawText: stripped,
          position: title.indexOf(stripped),
          sourceConfidence: 0.85,
        });
      }
    }
  }

  private generateFromBrackets(title: string, out: Candidate[]): void {
    const bracketMatch = title.match(/[『「【\[]([^」」】\]]+)[」」】\]]/);
    if (!bracketMatch) return;

    const bracketContent = bracketMatch[1];
    const segments = bracketContent.split(/\s*[-—–]\s*/);

    for (const seg of segments) {
      const candidate = seg.trim();
      if (candidate.length >= 2 && candidate.length <= 20) {
        out.push({
          name: candidate,
          source: 'bracket-content',
          rawText: candidate,
          position: title.indexOf(candidate),
          sourceConfidence: 0.7,
        });
      }
    }
  }

  private generateFromCoserPrefix(
    title: string,
    tags: string[],
    out: Candidate[],
  ): void {
    const coserMatch = title.match(
      /^(?:Coser|coser|Cos|cos|COS|COSER)[\s_\-]+(.+?)(?:\s*[-—–:：]|\s|$)/,
    );
    if (!coserMatch) return;

    const candidate = coserMatch[1].trim();
    if (candidate.length >= 2 && candidate.length <= 20) {
      out.push({
        name: candidate,
        source: 'coser-prefix',
        rawText: candidate,
        position: title.indexOf(candidate),
        sourceConfidence: 0.85,
      });
    }
  }

  private generateFromPipe(title: string, out: Candidate[]): void {
    if (!title.includes('|')) return;

    const parts = title.split(/\s*\|\s*/).filter((p) => p.length > 0);
    if (parts.length < 2) return;

    const first = parts[0].trim();
    if (first.length >= 2 && first.length <= 25) {
      const cleaned = first.replace(/\s+Cosplay\s*$/i, '').trim();
      if (cleaned.length >= 2 && cleaned.length <= 25) {
        out.push({
          name: cleaned,
          source: 'pipe-separator',
          rawText: cleaned,
          position: 0,
          sourceConfidence: 0.65,
        });
      }
    }
  }

  private async generateFromGameCharBefore(
    title: string,
    out: Candidate[],
  ): Promise<void> {
    const gameChar = await this.deps.matchGameCharacterInText(title);
    if (!gameChar) return;

    const charIndex = title.indexOf(gameChar);
    if (charIndex <= 0) return;

    const beforeChar = title.substring(0, charIndex).trim();
    if (!beforeChar) return;

    const separatorMatch = beforeChar.match(/^(.+?)\s*[-—–:]\s*/);
    let candidate: string;

    if (separatorMatch) {
      candidate = separatorMatch[1].trim();
    } else {
      candidate = beforeChar.replace(/[(][^)]*[)]$/, '').trim();
    }

    candidate = candidate.replace(/^[\s\-—–:]+|[\s\-—–:]+$/g, '');

    if (candidate.length >= 2 && candidate.length <= 25) {
      out.push({
        name: candidate,
        source: 'game-char-before',
        rawText: candidate,
        position: 0,
        sourceConfidence: 0.75,
      });
    }
  }

  private generateFromFirstWord(
    title: string,
    tags: string[],
    out: Candidate[],
  ): void {
    if (out.length > 0) return;


    const mixedWordMatch = title.match(/^([\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+[a-zA-Z]+|[a-zA-Z]+[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+)\s/);
    if (mixedWordMatch) {
      const candidate = mixedWordMatch[1].trim();
      if (candidate.length >= 2 && candidate.length <= 20) {
        out.push({
          name: candidate,
          source: 'first-word',
          rawText: candidate,
          position: 0,
          sourceConfidence: 0.5,
        });
      }
      return;
    }

    const englishChineseMatch = title.match(/^([a-zA-Z][a-zA-Z\s]*?[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+)/);
    if (englishChineseMatch) {
      const candidate = englishChineseMatch[1].trim();
      if (candidate.length > 20) {
        const englishOnly = candidate.match(/^([a-zA-Z][a-zA-Z]+)/);
        if (englishOnly && englishOnly[1].length >= 2) {
          out.push({
            name: englishOnly[1],
            source: 'english-name',
            rawText: englishOnly[1],
            position: 0,
            sourceConfidence: 0.5,
          });
          return;
        }
      }
      if (candidate.length >= 2 && candidate.length <= 25) {
        out.push({
          name: candidate,
          source: 'first-word',
          rawText: candidate,
          position: 0,
          sourceConfidence: 0.5,
        });
      }
      return;
    }

    const chineseWordMatch = title.match(/^([\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]{2,8})\s/);
    if (chineseWordMatch) {
      const candidate = chineseWordMatch[1].trim();
      if (candidate.length >= 2 && candidate.length <= 8) {
        out.push({
          name: candidate,
          source: 'first-word',
          rawText: candidate,
          position: 0,
          sourceConfidence: 0.45,
        });
      }
    }
  }

  private generateFromTagFuzzy(
    title: string,
    tags: string[],
    out: Candidate[],
  ): void {
    for (const tag of tags) {
      if (NON_PERSON_TAGS.has(tag)) continue;
      if (tag.length < 2 || tag.length > 20) continue;

      const separatorMatch = title.match(/^(.+?)\s*[-—–|]/);
      const firstSegment = separatorMatch ? separatorMatch[1] : title;

      if (firstSegment.includes(tag) && !title.startsWith(tag)) {
        const pos = firstSegment.indexOf(tag);
        out.push({
          name: tag,
          source: 'tag-fuzzy',
          rawText: tag,
          position: pos,
          sourceConfidence: 0.6,
        });
      }
    }
  }
}


export interface ScorerConfig {
  weights: {
    nameFeature: number;
    patternMatch: number;
    tagCorrelation: number;
    knownPerson: number;
    historicalFrequency: number;
    negativeIndicator: number;
  };
  minScore: number;
}

const DEFAULT_SCORER_CONFIG: ScorerConfig = {
  weights: {
    nameFeature: 0.25,
    patternMatch: 0.15,
    tagCorrelation: 0.20,
    knownPerson: 0.15,
    historicalFrequency: 0.10,
    negativeIndicator: 0.15,
  },
  minScore: 0.35,
};

const NEGATIVE_INDICATORS = [
  '作品', '合集', '月', '日', '年', '季度', '期', ' vol',
  '打赏', '资源', '小剧场', '预告', '整理', '篇',
  '图包', '套图', '系列', '完整', '修正', '重制',
  'Porn', 'Nudes', 'Generated', 'JKL', '写真合集',
  '福利姬', '私房写真', '模特写真',
];

const CATEGORY_KEYWORDS_SET = new Set([
  'JK制服', 'jk制服', 'Cosplay', 'cosplay', 'COSPLAY',
  '写真', '私房', '视频', '图包', '套图', '合集',
  '作品', '整理', '系列', '精选',
]);


export class ConfidenceScorer {
  constructor(
    private deps: CandidateGeneratorDeps,
    private config: ScorerConfig = DEFAULT_SCORER_CONFIG,
  ) {}

  
  async score(candidates: Candidate[], title: string, tags: string[]): Promise<ScoredCandidate[]> {
    const scored: ScoredCandidate[] = [];

    for (const candidate of candidates) {
      const breakdown = await this.scoreSingle(candidate, title, tags);
      const score = this.computeWeightedScore(breakdown);

      scored.push({
        ...candidate,
        score,
        scoreBreakdown: breakdown,
      });
    }

    scored.sort((a, b) => b.score - a.score);

    return scored;
  }

  
  private async scoreSingle(
    candidate: Candidate,
    title: string,
    tags: string[],
  ): Promise<ScoreBreakdown> {
    return {
      nameFeature: this.scoreNameFeature(candidate.name),
      patternMatch: this.scorePatternMatch(candidate, title),
      tagCorrelation: this.scoreTagCorrelation(candidate.name, tags),
      knownPerson: await this.scoreKnownPerson(candidate.name),
      historicalFrequency: this.scoreHistoricalFrequency(candidate.name),
      negativeIndicator: this.scoreNegativeIndicator(candidate.name, tags),
    };
  }

  
  private scoreNameFeature(name: string): number {
    if (!name) return 0;

    const trimmed = name.trim();
    let score = 0;

    // Lengthrating (0-0.35)
    const lengthProb = this.deps.patternModel.getLengthProbability(trimmed.length);
    score += lengthProb * 0.35;

    const compProb = this.deps.patternModel.getCompositionProbability(trimmed);
    score += compProb * 0.35;

    const firstChar = trimmed[0];
    if (/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(firstChar)) {
      score += 0.15; // CJK characters most common at start
    } else if (/[a-zA-Z]/.test(firstChar)) {
      score += 0.12; // English also common at start
    } else if (/\d/.test(firstChar)) {
      score += 0.02; // Digits rarely start a person name
    }

    if (/[『「【\[「』」】\]]/.test(trimmed)) {
      score -= 0.15;
    }

    return Math.max(0, Math.min(1, score));
  }

  
  private scorePatternMatch(candidate: Candidate, title: string): number {
    const sourceHitRate = this.deps.patternModel.getSourceHitRate(candidate.source);
    const sourceScore = candidate.sourceConfidence * 0.6 + sourceHitRate * 0.4;

    return Math.max(0, Math.min(1, sourceScore));
  }

  
  private scoreTagCorrelation(name: string, tags: string[]): number {
    if (!name || tags.length === 0) return 0.2;

    if (tags.includes(name)) {
      return 1.0;
    }

    for (const tag of tags) {
      if (tag.includes(name) && name.length >= 2) {
        return 0.8;
      }
    }

    for (const tag of tags) {
      if (name.includes(tag) && tag.length >= 2) {
        return 0.6;
      }
    }

    // PinyinMatchTag
    const namePinyin = getPinyinService().getVariants(name).full;
    if (namePinyin) {
      for (const tag of tags) {
        const tagPinyin = getPinyinService().getVariants(tag).full;
        if (tagPinyin && tagPinyin === namePinyin) {
          return 0.75;
        }
      }
    }

    return 0.2;
  }

  
  private async scoreKnownPerson(name: string): Promise<number> {
    if (!name) return 0;

    if (this.deps.patternModel.isKnownName(name)) {
      return 1.0;
    }

    const fuzzyMatch = this.deps.patternModel.fuzzyMatchKnownName(name, 0.85);
    if (fuzzyMatch) {
      return 0.85;
    }

    const isGameChar = await this.deps.isGameCharacter(name);
    if (isGameChar) {
      return 0.0; // Game character names are not cosplayers
    }

    return 0.1;
  }

  private scoreHistoricalFrequency(name: string): number {
    const freq = this.deps.patternModel.getNameFrequency(name);
    if (freq === 0) return 0.1; // New name, low-neutral score
    if (freq >= 5) return 1.0;
    if (freq >= 3) return 0.85;
    if (freq >= 2) return 0.7;
    return 0.5;
  }

  
  private scoreNegativeIndicator(name: string, tags: string[]): number {
    if (!name) return 0;

    let penalty = 0;

    // BlocklistCheck
    if (this.deps.patternModel.isBlacklisted(name)) {
      penalty += 0.8;
    }

    const lowerName = name.toLowerCase();
    for (const indicator of NEGATIVE_INDICATORS) {
      if (lowerName.includes(indicator.toLowerCase())) {
        penalty += 0.5;
        break;
      }
    }

    if (CATEGORY_KEYWORDS_SET.has(name.trim())) {
      penalty += 0.6;
    }

    if (/^\d/.test(name)) {
      penalty += 0.4;
    }

    if (/^[A-Za-z]+\.?\d+/.test(name) && name.length <= 8) {
      penalty += 0.3;
    }

    if (/\d+P\d*V?$/i.test(name)) {
      penalty += 0.5;
    }

    if (name.length > 20) {
      penalty += 0.3;
    }

    return Math.max(0, 1 - penalty);
  }

  
  private computeWeightedScore(breakdown: ScoreBreakdown): number {
    const w = this.config.weights;
    return (
      breakdown.nameFeature * w.nameFeature +
      breakdown.patternMatch * w.patternMatch +
      breakdown.tagCorrelation * w.tagCorrelation +
      breakdown.knownPerson * w.knownPerson +
      breakdown.historicalFrequency * w.historicalFrequency +
      breakdown.negativeIndicator * w.negativeIndicator
    );
  }
}


/**
 *
 * 1. Createengineinstance
 */
export class AdaptiveExtractor {
  private patternModel: PatternModel;
  private generator: CandidateGenerator;
  private scorer: ConfidenceScorer;
  private initialized = false;

  constructor(deps: CandidateGeneratorDeps, config: ScorerConfig = DEFAULT_SCORER_CONFIG) {
    this.patternModel = deps.patternModel;
    this.generator = new CandidateGenerator(deps);
    this.scorer = new ConfidenceScorer(deps, config);
  }

  
  learnFromSamples(
    samples: Array<{ title: string; protagonist: string; tags?: string[] }>,
  ): void {
    for (const { title, protagonist, tags } of samples) {
      this.patternModel.learn(title, protagonist, tags || []);
    }

    const falsePositives = this.patternModel.detectFalsePositives();
    if (falsePositives.length > 0) {
      console.log(
        `[AdaptiveExtractor] Auto-detected ${falsePositives.length} suspected false positive names: ${falsePositives.join(', ')}`,
      );
      for (const fp of falsePositives) {
        this.patternModel.addToBlacklist(fp);
      }
    }

    this.initialized = true;
  }

  
  addFalsePositive(name: string): void {
    this.patternModel.addToBlacklist(name);
  }

  
  async extract(
    title: string,
    tags: string[] = [],
  ): Promise<AdaptiveExtractionResult | null> {
    if (!title) return null;

    if (isAIGenerated(title)) return null;

    const candidates = await this.generator.generate(title, tags);

    if (candidates.length === 0) {
      return null;
    }

    const deduped = this.deduplicate(candidates);

    // Rating
    const scored = await this.scorer.score(deduped, title, tags);

    if (scored.length === 0) return null;

    const merged = this.mergePrefixCandidates(scored);

    const best = merged[0];

    const isHit = best.score >= 0.35;
    this.patternModel.recordSourceOutcome(best.source, isHit);

    return {
      name: best.name,
      confidence: best.score,
      source: best.source,
      scoreBreakdown: best.scoreBreakdown,
      allCandidates: merged,
    };
  }

  
  private deduplicate(candidates: Candidate[]): Candidate[] {
    const byName = new Map<string, Candidate>();

    for (const c of candidates) {
      const key = c.name.toLowerCase();
      const existing = byName.get(key);
      if (!existing || c.sourceConfidence > existing.sourceConfidence) {
        byName.set(key, c);
      }
    }

    return Array.from(byName.values());
  }

  
  private mergePrefixCandidates(scored: ScoredCandidate[]): ScoredCandidate[] {
    if (scored.length <= 1) return scored;

    const result = [...scored];

    for (let i = 0; i < result.length; i++) {
      for (let j = 0; j < result.length; j++) {
        if (i === j) continue;
        const a = result[i];
        const b = result[j];

        if (b.name.startsWith(a.name) && b.name.length > a.name.length) {
          if (b.score >= a.score * 0.85) {
            const lengthBonus = Math.min(0.1, (b.name.length - a.name.length) * 0.02);
            result[j] = {
              ...b,
              score: b.score + lengthBonus,
            };
          }
        }
      }
    }

    result.sort((a, b) => b.score - a.score);
    return result;
  }

  
  getStats(): ReturnType<PatternModel['getStats']> {
    return this.patternModel.getStats();
  }

  
  isInitialized(): boolean {
    return this.initialized;
  }
}
