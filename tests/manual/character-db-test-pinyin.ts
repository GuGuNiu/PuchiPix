/**
 * 拼音匹配器测试脚本
 *
 * 测试 Pinyin-Pro + 别名库的动态识别能力
 *
 * 运行: npx tsx tests/manual/character-db-test-pinyin.ts
 */

import { getCharacterDBService } from '@/lib/character-db/character-db-service';

async function test() {
  console.log('=== 拼音匹配器 + 别名库测试 ===\n');

  const dbService = getCharacterDBService();

  try {
    await dbService.load();
    console.log('✅ 数据库加载成功\n');

    // 测试用例：包含错误拼写和变体的标题
    const testCases = [
      {
        title: '雪晴Astra - 原神 leidianjiangjun OL',
        expected: '雷电将军',
        description: '拼音全拼错误拼写',
      },
      {
        title: '西园寺南歌 - 碧蓝航线 莫加多尔护士',
        expected: '莫加多尔',
        description: '正确拼写',
      },
      {
        title: '黏黏团子兔 - 崩坏星穹铁道 遐蝶',
        expected: '遐蝶',
        description: '正确拼写',
      },
      {
        title: 'cosplay - 原神 hutao 堂主',
        expected: '胡桃',
        description: '拼音 + 别名',
      },
      {
        title: '星穹铁道 kafka 妈妈',
        expected: '卡芙卡',
        description: '英文名 + 昵称',
      },
      {
        title: '鸣潮 jinxi 今州令尹',
        expected: '今汐',
        description: '拼音 + 别名',
      },
      {
        title: '碧蓝航线 xinnong 大白狐狸',
        expected: '信浓',
        description: '拼音 + 昵称',
      },
      {
        title: '原神 雷神 雷电影',
        expected: '雷电将军',
        description: '别名匹配',
      },
      {
        title: '星穹铁道 黄泉 ying芽',
        expected: '黄泉',
        description: '别名（芽衣）',
      },
    ];

    console.log('2. 测试动态识别\n');

    let passed = 0;
    let failed = 0;

    for (const testCase of testCases) {
      console.log(`测试: ${testCase.description}`);
      console.log(`  标题: ${testCase.title}`);
      console.log(`  期望: ${testCase.expected}`);

      const matches = dbService.identifyInText(testCase.title);
      const topMatch = matches[0];

      if (topMatch) {
        const isCorrect = topMatch.character.name === testCase.expected;
        console.log(`  结果: ${topMatch.character.name} (${topMatch.matchType}, 置信度: ${topMatch.confidence.toFixed(2)})`);
        console.log(`  状态: ${isCorrect ? '✅ 通过' : '❌ 失败'}`);
        if (isCorrect) passed++; else failed++;
      } else {
        console.log(`  结果: ❌ 未识别到角色`);
        failed++;
      }

      // 显示所有匹配结果
      if (matches.length > 1) {
        console.log(`  其他匹配:`);
        matches.slice(1, 4).forEach(m => {
          console.log(`    - ${m.character.name} (${m.matchType}, ${m.confidence.toFixed(2)})`);
        });
      }

      console.log('');
    }

    console.log('3. 测试 TAG 识别\n');

    const testTags = [
      'ldjj',           // 雷电将军首字母
      'hutao',          // 胡桃拼音
      'kafuka',         // 卡芙卡错误拼音
      'jingliu',        // 镜流拼音
      '雷电',           // 雷电将军别名
      '堂主',           // 胡桃别名
    ];

    console.log(`TAG列表: [${testTags.join(', ')}]`);
    const tagMatches = dbService.identifyInTags(testTags);

    console.log('\n识别结果:');
    tagMatches.forEach(m => {
      console.log(`  → ${m.character.name} (${m.character.gameName}) [${m.matchType}] 置信度: ${m.confidence.toFixed(2)}`);
    });

    console.log('\n=== 测试结果统计 ===');
    console.log(`通过: ${passed}/${testCases.length}`);
    console.log(`失败: ${failed}/${testCases.length}`);
    console.log(`成功率: ${((passed / testCases.length) * 100).toFixed(1)}%`);

  } catch (err) {
    console.error('❌ 测试失败:', err);
  }

  console.log('\n=== 测试完成 ===');
}

test().catch(console.error);
