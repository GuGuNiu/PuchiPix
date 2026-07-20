/**
 * 拼音服务测试脚本
 *
 * 运行: npx tsx tests/manual/pinyin-service-test.ts
 */

import { getPinyinService, createSimilarityCalculator } from '@/lib/core/pinyin-service';

async function test(): Promise<void> {
  console.log('=== 拼音服务测试 ===\n');

  const service = getPinyinService();

  // 1. 拼音转换测试
  console.log('1. 拼音转换测试');
  const testTexts = ['雷电将军', '胡桃', '卡芙卡'];
  for (const text of testTexts) {
    const variants = service.getVariants(text);
    console.log(`  ${text}:`);
    console.log(`    全拼: ${variants.full}`);
    console.log(`    首字母: ${variants.initials}`);
  }

  // 2. 相似度算法测试
  console.log('\n2. 相似度算法测试');
  const testPairs = [
    ['leidianjiangjun', 'leidianjignjun'],
    ['hutao', 'hutiao'],
    ['kafuka', 'kafuka'],
  ];

  const algorithms = ['levenshtein', 'jaroWinkler', 'bigram', 'combined'] as const;

  for (const [s1, s2] of testPairs) {
    console.log(`\n  "${s1}" vs "${s2}":`);
    for (const algo of algorithms) {
      const calculator = createSimilarityCalculator(algo);
      const sim = calculator.calculate(s1, s2);
      console.log(`    ${algo}: ${sim.toFixed(3)}`);
    }
  }

  // 3. 智能匹配测试
  console.log('\n3. 智能匹配测试');
  const candidates = [
    { name: '雷电将军', aliases: ['雷神', '雷电影'] },
    { name: '胡桃', aliases: ['堂主', '胡堂主'] },
    { name: '卡芙卡', aliases: ['卡妈', '妈妈'] },
  ];

  const testQueries = ['ldjj', 'hutao', 'kafuka', '雷神'];

  for (const query of testQueries) {
    console.log(`\n  查询: "${query}"`);
    const matches = service.smartMatch(query, candidates);
    matches.forEach(m => {
      console.log(`    → ${m.item.name} [${m.matchType}] 置信度: ${m.confidence.toFixed(2)}`);
    });
  }

  // 4. 缓存统计
  console.log('\n4. 缓存统计');
  const stats = service.getCacheStats();
  console.log(`  缓存大小: ${stats.size}`);
  console.log(`  缓存启用: ${stats.enabled}`);

  console.log('\n=== 测试完成 ===');
}

test().catch(console.error);
