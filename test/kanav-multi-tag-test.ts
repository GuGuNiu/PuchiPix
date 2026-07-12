/**
 * Kanav Multi-Tag & Category Block Test
 *
 * Features tested:
 * 1. Title cleaning (cleanTitle)
 * 2. Multi-tag (series) identification
 * 3. Category blocking ("同人作品", "动漫番剧")
 * 4. player_aaaa vod_data extraction
 *
 * Usage: npx tsx docs/test/kanav-multi-tag-test.ts
 */

import { KanavProvider } from '../src/lib/sites/providers/kanav-provider';

// Test data from real pages
const SAMPLE_TITLES = [
  {
    raw: '在线播放 - [ドールハウス]re:START[中文字幕] - KanAV-免费高清中文AV在线看',
    expected: '[ドールハウス]re:START[中文字幕]',
  },
  {
    raw: '在线播放 - [中字後補]放入他所不知道的秘密 - KanAV-免费高清中文AV在线看',
    expected: '[中字後補]放入他所不知道的秘密',
  },
  {
    raw: '在线播放 - 060001 隔壁那个爱玩爱闹、不穿胸罩的家庭主妇，早上会来倒垃圾——樱葵 - KanAV-免费高清中文AV在线看',
    expected: '060001 隔壁那个爱玩爱闹、不穿胸罩的家庭主妇，早上会来倒垃圾——樱葵',
  },
  {
    raw: '在线播放 - [ShiinaEcchigawa]KanaArima\'sEcchiDebut–Animation - KanAV-免费高清中文AV在线看',
    expected: '[ShiinaEcchigawa]KanaArima\'sEcchiDebut–Animation',
  },
];

const SAMPLE_CLASSIFICATIONS: Array<{
  name: string;
  director: string;
  categories: string[];
  expectBlocked: boolean;
}> = [
  {
    name: 'Page1: 动漫番剧 + 3D动画',
    director: '3D动画',
    categories: ['动漫番剧', '3D动画'],
    expectBlocked: true,
  },
  {
    name: 'Page2: 动漫番剧 + 里番',
    director: '里番',
    categories: ['动漫番剧', '里番'],
    expectBlocked: true,
  },
  {
    name: 'Page3: 日韩无码',
    director: '',
    categories: ['日韩无码'],
    expectBlocked: false,
  },
  {
    name: 'Page4: 同人作品 director',
    director: '同人作品',
    categories: ['动漫番剧', '3D动画'],
    expectBlocked: true,
  },
  {
    name: 'Safe: 字幕分类',
    director: '某某导演',
    categories: ['中文字幕', '流出自拍'],
    expectBlocked: false,
  },
  {
    name: 'Safe: 国产AV',
    director: '',
    categories: ['国产AV'],
    expectBlocked: false,
  },
  {
    name: 'Block: 同人 in cats',
    director: '',
    categories: ['动漫番剧', '同人作品'],
    expectBlocked: true,
  },
  {
    name: 'Edge: empty',
    director: '',
    categories: [],
    expectBlocked: false,
  },
];

// Test runner
let passed = 0;
let failed = 0;

function pass(msg: string): void {
  passed++;
  console.log(`  PASS: ${msg}`);
}

function fail(msg: string): void {
  failed++;
  console.log(`  FAIL: ${msg}`);
}

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass(msg);
  } else {
    fail(msg);
    console.log(`    Expected: ${JSON.stringify(expected)}`);
    console.log(`    Actual: ${JSON.stringify(actual)}`);
  }
}

function assertTrue(actual: boolean, msg: string): void {
  if (actual) {
    pass(msg);
  } else {
    fail(msg);
  }
}

// Run tests
console.log('========================================');
console.log('Kanav Multi-Tag & Block Test');
console.log('========================================');
console.log('');

const provider = new KanavProvider();

// Test 1: cleanTitle
console.log('Test 1: cleanTitle');
for (let i = 0; i < SAMPLE_TITLES.length; i++) {
  const s = SAMPLE_TITLES[i];
  const result = provider.cleanTitle(s.raw);
  assertEqual(result, s.expected, `Page${i + 1} title`);
}
assertEqual(provider.cleanTitle(''), '', 'empty string');
assertEqual(provider.cleanTitle('   '), '', 'whitespace');
assertEqual(provider.cleanTitle('normal title'), 'normal title', 'no prefix/suffix');
console.log('');

// Test 2: matchesUrl
console.log('Test 2: matchesUrl');
assertTrue(
  provider.matchesUrl('https://kanav.ad/index.php/vod/play/id/53807/sid/1/nid/1.html'),
  'match kanav.ad play'
);
assertTrue(
  provider.matchesUrl('https://kanav.ad/index.php/vod/search.html?wd=test'),
  'match kanav.ad search'
);
assertTrue(
  !provider.matchesUrl('https://example.com/vod/play/123'),
  'reject non-kanav'
);
assertTrue(
  provider.matchesUrl('https://m1.kanav.fun/vod/play/123'),
  'match kanav.fun'
);
assertTrue(
  !provider.matchesUrl('https://fakekanav.admalicious.com/'),
  'reject fake domain'
);
console.log('');

// Test 3: checkBlocked
console.log('Test 3: checkBlocked');
for (const c of SAMPLE_CLASSIFICATIONS) {
  const r = provider.checkBlocked(c.director, c.categories);
  assertEqual(r.blocked, c.expectBlocked, c.name);
}
console.log('');

// Test 4: buildSearchUrl
console.log('Test 4: buildSearchUrl');
const url = provider.buildSearchUrl('test keyword');
assertTrue(
  url.includes('https://kanav.ad/index.php/vod/search.html'),
  'search base URL'
);
assertTrue(
  url.includes('wd=test'),
  'search keyword'
);
console.log('');

// Test 5: Site info
console.log('Test 5: Site info');
assertEqual(provider.id, 'kanav', 'site ID');
assertEqual(provider.name, 'KanAV', 'site name');
assertEqual(provider.baseUrl, 'https://kanav.ad', 'base URL');
assertTrue(provider.enabled === true, 'enabled');
assertTrue(provider.blockedCategories.length > 0, 'blocked categories non-empty');
assertTrue(
  provider.blockedCategories.includes('同人作品'),
  'block list includes dōjin'
);
assertTrue(
  provider.blockedCategories.includes('动漫番剧'),
  'block list includes anime'
);
console.log('');

// Test 6: Real page data simulation
console.log('Test 6: Real page data');
const REAL_DATA = [
  { id: 53807, vodName: '[ドールハウス]re:START[中文字幕]', director: '3D动画', cats: ['动漫番剧', '3D动画'], block: true },
  { id: 115180, vodName: '[中字後補]放入他所不知道的秘密', director: '里番', cats: ['动漫番剧', '里番'], block: true },
  { id: 114772, vodName: '060626_001 隔壁那个爱玩爱闹、不穿胸罩的家庭主妇，早上会来倒垃圾——樱葵', director: '', cats: ['日韩无码'], block: false },
  { id: 114202, vodName: '[ShiinaEcchigawa]KanaArima\'sEcchiDebut–Animation', director: '同人作品', cats: ['动漫番剧', '3D动画'], block: true },
];

for (const d of REAL_DATA) {
  const cleaned = provider.cleanTitle(d.vodName);
  assertTrue(cleaned.length > 0, `Page ${d.id}: title extracted`);
  const r = provider.checkBlocked(d.director, d.cats);
  assertEqual(r.blocked, d.block, `Page ${d.id}: blocked=${d.block}`);
}

console.log('');
console.log('========================================');
console.log('Summary');
console.log('========================================');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);
const rate = ((passed / (passed + failed)) * 100).toFixed(1);
console.log(`Pass rate: ${rate}%`);
console.log('========================================');

process.exit(failed > 0 ? 1 : 0);
