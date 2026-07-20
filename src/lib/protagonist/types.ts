export interface ProtagonistParseResult {
  rawName: string;
  standardName: string;
  chinesePart: string;
  pinyinPart: string;
  isMixedName: boolean;
  confidence: number;
  matchedAliases: string[];
}

export interface ProtagonistStats {
  standardName: string;
  count: number;
  aliases: { name: string; count: number }[];
  /** GraphlibraryList */
  galleries: { id: number; title: string; coverUrl: string }[];
}
