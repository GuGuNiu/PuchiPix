/** 主角名字解析结果 */
export interface ProtagonistParseResult {
  /** 提取到的原始名字 */
  rawName: string;
  /** 标准化后的名字（数据库中的标准名） */
  standardName: string;
  /** 中文部分 */
  chinesePart: string;
  /** 拼音/英文部分 */
  pinyinPart: string;
  /** 是否是混名 */
  isMixedName: boolean;
  /** 置信度（0-1） */
  confidence: number;
  /** 匹配的别名列表 */
  matchedAliases: string[];
}

/** 主角统计信息 */
export interface ProtagonistStats {
  /** 标准名字 */
  standardName: string;
  /** 出现次数 */
  count: number;
  /** 所有别名及其出现次数 */
  aliases: { name: string; count: number }[];
  /** 图库列表 */
  galleries: { id: number; title: string; coverUrl: string }[];
}
