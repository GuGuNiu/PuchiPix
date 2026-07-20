/**
 * 角色识别库测试脚本
 *
 * 运行: npx tsx tests/manual/character-db-test.ts
 */

import { getCharacterDBService, GAME_LABELS } from '@/lib/character-db';

async function test(): Promise<void> {
  console.log('=== 角色识别库测试 ===\n');

  console.log('1. 测试 CharacterDBService');
  const dbService = getCharacterDBService();

  try {
    await dbService.load();
    console.log('✅ 数据库加载成功');
    console.log(`   总角色数: ${dbService.getAllCharacters().length}`);
    console.log(`   游戏数: ${dbService.getAllGames().length}`);

    // 测试识别
    const testTitles = [
      '西园寺南歌 - 碧蓝航线 莫加多尔护士',
      '雪晴Astra - 原神 雷电将军OL',
      '黏黏团子兔 - 崩坏星穹铁道 遐蝶',
    ];

    console.log('\n2. 测试角色识别');
    for (const title of testTitles) {
      const matches = dbService.identifyInText(title);
      console.log(`\n   标题: ${title}`);
      matches.forEach(m => {
        console.log(`   → 识别到: ${m.character.name} (${m.character.gameName}) [${m.matchType}]`);
      });
    }
  } catch (err) {
    console.error('❌ 测试失败:', err);
  }

  console.log('\n3. 测试游戏角色过滤');
  try {
    const allChars = dbService
      .getAllCharacters()
      .filter(c => c.category === 'game');
    console.log(`✅ 获取游戏角色成功: ${allChars.length} 个`);

    const stats = dbService.getStats();
    console.log('\n   各游戏角色数:');
    Object.entries(stats).forEach(([game, count]) => {
      console.log(`   - ${GAME_LABELS[game as keyof typeof GAME_LABELS] || game}: ${count}`);
    });

    // 测试识别
    const testTags = ['雷电将军', '碧蓝航线', '莫加多尔', 'cosplay'];
    const matches = dbService
      .identifyInTags(testTags)
      .filter(m => m.character.category === 'game');
    console.log(`\n   TAG识别测试: [${testTags.join(', ')}]`);
    matches.forEach((m) => {
      console.log(`   → ${m.character.name} (${m.confidence})`);
    });
  } catch (err) {
    console.error('❌ 游戏角色测试失败:', err);
  }

  console.log('\n=== 测试完成 ===');
}

test().catch(console.error);
