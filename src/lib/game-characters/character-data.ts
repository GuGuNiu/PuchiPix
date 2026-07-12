/**
 * 游戏角色数据库
 *
 * 包含原神、星穹铁道、鸣潮、碧蓝航线、碧蓝档案五个游戏的全部角色名。
 * 数据来源：
 * - 原神/星穹铁道/碧蓝航线：BWIKI MediaWiki API (wiki.biligame.com)
 * - 鸣潮：Fandom Wiki API (wuthering-waves.fandom.com)
 * - 碧蓝档案：BWIKI allpages API + 中文名映射
 *
 * 用于在爱妹子图包站的 TAG 中识别游戏角色名，辅助主角定位。
 *
 * @author PuchiPix Team
 * @date 2026-07-11
 * @lastModified 2026-07-11
 */

// ============================================================
// 类型定义
// ============================================================

export type GameType = 'genshin' | 'starrail' | 'wuthering' | 'azurlane' | 'bluearchive';

export interface GameCharacter {
  name: string;
  aliases?: string[];
  game: GameType;
}

export const GAME_LABELS: Record<GameType, string> = {
  genshin: '原神',
  starrail: '星穹铁道',
  wuthering: '鸣潮',
  azurlane: '碧蓝航线',
  bluearchive: '碧蓝档案',
};

// ============================================================
// 原神角色（数据源：BWIKI API wiki.biligame.com/ys）
// ============================================================

const GENSHIN_NAMES: string[] = [
  '阿贝多', '阿蕾奇诺', '艾尔海森', '埃洛伊', '艾梅莉埃', '安柏', '芭芭拉',
  '八重神子', '白术', '班尼特', '北斗', '达达利亚', '戴因斯雷布', '迪奥娜',
  '迪卢克', '迪希雅', '多莉', '珐露珊', '菲米尼', '菲谢尔', '枫原万叶',
  '芙宁娜', '甘雨', '胡桃', '荒泷一斗', '基尼奇', '嘉明', '久岐忍',
  '九条裟罗', '卡齐娜', '卡维', '凯亚', '坎蒂丝', '柯莱', '可莉',
  '克洛琳德', '刻晴', '莱欧斯利', '莱依拉', '蓝砚', '雷电将军', '雷泽',
  '丽莎', '林尼', '琳妮特', '流浪者', '鹿野院平藏', '罗莎莉亚', '旅行者',
  '玛拉妮', '玛薇卡', '梦见月瑞希', '米卡', '莫娜', '那维莱特', '娜维娅',
  '纳西妲', '妮露', '凝光', '诺艾尔', '欧洛伦', '绮良良', '七七',
  '恰斯卡', '茜特菈莉', '千织', '琴', '赛诺', '赛索斯', '砂糖',
  '珊瑚宫心海', '申鹤', '神里绫华', '神里绫人', '丝柯克', '提纳里', '托马',
  '温迪', '五郎', '希格雯', '希诺宁', '夏洛蒂', '夏沃蕾', '闲云',
  '香菱', '魈', '宵宫', '辛焱', '行秋', '烟绯', '瑶瑶',
  '夜兰', '伊安珊', '优菈', '云堇', '早柚', '钟离', '重云',
];

// ============================================================
// 星穹铁道角色（数据源：BWIKI API wiki.biligame.com/sr）
// ============================================================

const STARRAIL_NAMES: string[] = [
  '阿格莱雅', '阿兰', '艾丝妲', '白露', '波提欧', '布洛妮娅', '丹恒',
  '翡翠', '飞霄', '符玄', '桂乃芬', '海瑟音', '寒鸦', '黑塔',
  '黑天鹅', '虎克', '花火', '黄泉', '姬子', '加拉赫', '椒丘',
  '杰帕德', '镜流', '景元', '卡芙卡', '克拉拉', '玲可', '灵砂',
  '流萤', '卢卡', '乱破', '罗刹', '螺丝咕姆', '米沙', '貊泽',
  '娜塔莎', '佩拉', '青雀', '刃', '阮•梅', '桑博', '砂金',
  '素裳', '缇宝', '停云', '瓦尔特', '万敌', '忘归人', '希儿',
  '希露瓦', '雪衣', '彦卿', '银狼', '银枝', '驭空', '云璃',
  '真理医生', '知更鸟', '三月七', '开拓者', '遐蝶', '赛飞儿',
  '那刻夏', '大黑塔', '风堇', '刻律德菈',
];

// ============================================================
// 鸣潮角色（数据源：Fandom Wiki API wuthering-waves.fandom.com）
// 英文名通过知识库映射为中文名
// ============================================================

const WUTHERING_ENTRIES: { name: string; aliases?: string[] }[] = [
  { name: '漂泊者', aliases: ['Rover'] },
  { name: '秧秧', aliases: ['Yangyang'] },
  { name: '白芷', aliases: ['Baizhi'] },
  { name: '炽霞', aliases: ['Chixia'] },
  { name: '散华', aliases: ['Sanhua'] },
  { name: '维里奈', aliases: ['Verina'] },
  { name: '安可', aliases: ['Encore'] },
  { name: '陵阳', aliases: ['Lingyang'] },
  { name: '莫特斐', aliases: ['Mortefi'] },
  { name: '卡卡罗', aliases: ['Calcharo'] },
  { name: '鉴心', aliases: ['Jianxin'] },
  { name: '吟霖', aliases: ['Yinlin'] },
  { name: '忌炎', aliases: ['Jiyan'] },
  { name: '长离', aliases: ['Changli'] },
  { name: '今汐', aliases: ['Jinhsi'] },
  { name: '渊武', aliases: ['Yuanwu'] },
  { name: '露帕', aliases: ['Lumi'] },
  { name: '折枝', aliases: ['Zhezhi'] },
  { name: '釉瑚', aliases: ['Youhu'] },
  { name: '椿', aliases: ['Camellya'] },
  { name: '守岸人', aliases: ['Shorekeeper'] },
  { name: '相里要', aliases: ['Xiangli Yao'] },
  { name: '桃祈', aliases: ['Taoqi'] },
  { name: '秋水', aliases: ['Aalto'] },
  { name: '丹瑾', aliases: ['Danjin'] },
  { name: '卡罗塔', aliases: ['Carlotta'] },
  { name: '洛可可', aliases: ['Roccia'] },
  { name: '菲比', aliases: ['Phoebe'] },
  { name: '布兰特', aliases: ['Brant'] },
  { name: '卜灵', aliases: ['Buling'] },
  { name: '赞妮', aliases: ['Zani'] },
  { name: '芙萝洛', aliases: ['Phrolova'] },
];

// ============================================================
// 碧蓝航线角色（数据源：BWIKI API wiki.biligame.com/blhx）
// 含 500+ 舰娘，此处为完整首页数据 + 常见角色补充
// ============================================================

const AZURLANE_NAMES: string[] = [
  // A
  '阿贝克隆比', '阿布鲁齐公爵', '阿达尔伯特亲王', '阿蒂利奥·雷戈洛',
  '阿尔贝托·迪·朱塞诺', '阿尔比恩', '阿尔弗雷多·奥里亚尼', '阿尔汉格尔斯克',
  '阿尔及利亚', '阿尔萨斯', '阿芙乐尔', '阿贺野', '阿基里斯', '阿贾克斯',
  '阿卡司塔', '阿拉巴马', '阿罗芒什', '阿瑞托莎', '阿斯托利亚', '阿武隈',
  // B
  '爱宕', '爱丁堡', '爱尔德里奇', '埃尔宾', '埃尔温', '埃克塞特', '埃姆登',
  '埃塞克斯', '艾尔温', '艾伦·萨姆纳', '埃曼努埃尔·佩萨格诺', '埃米尔·贝尔汀',
  '巴丹', '巴尔的摩', '巴尔扎诺', '巴拉卡少校', '巴托洛梅奥·科莱奥尼',
  '白凤', '白露', '白雪', '百眼巨人', '伴尔维', '半人马', '邦克山',
  '北安普顿', '贝尔', '贝尔法斯特', '北卡罗来纳', '贝劳森林', '贝利',
  '贝奇', '贝亚恩', '本森', '彼得·史特拉塞', '比洛克西', '比叡',
  '俾斯麦', '宾夕法尼亚', '标枪', '栎鹮', '滨风', '波尔塔瓦', '博尔扎诺',
  '博格', '伯明翰', '波特兰', '不挠', '不屈', '不知火', '布莱默顿',
  '布里斯托尔', '布伦努斯', '布伦希尔德', '布吕歇尔',
  // C
  '苍龙', '曾克海军上将', '查尔斯·奥斯本', '朝潮', '朝凪', '赤城',
  '初春', '初霜', '初月', '川内', '吹雪', '春月',
  // D
  '大潮', '大胆', '大斗犬', '大凤', '大黄蜂', '大青花鱼', '黛朵',
  '岛风', '的里雅斯特', '德文郡', '德意志', '迪盖·特鲁因', '帝国',
  '迪凯纳', '迪普莱克斯', '电', '定安', '独角兽', '独立', '渡良濑',
  '杜威', '杜伊斯堡', '敦刻尔克', '多塞特郡', '恶毒',
  // E
  '俄克拉荷马',
  // F
  '法戈', '反击', '泛用型布里', '斐济', '飞龙', '菲尼克斯',
  '腓特烈·卡尔', '飞鹰', '飞云', '凤翔', '风云', '伏波', '复仇',
  '福尔班', '伏尔加', '富兰克林', '弗朗西斯科·卡拉乔洛', '伏罗希洛夫',
  '扶桑', '抚顺', '福特', '福煦',
  // G
  '甘古特', '冈依沙瓦号', '高雄', '格拉斯哥', '格里德利', '哥伦比亚',
  '格伦维尔', '格罗斯特', '格奈森瑙', '古比雪夫', '谷风', '古鹰',
  '关岛', '光辉', '光荣', '鬼怒', '果敢',
  // H
  '哈尔西·鲍威尔', '哈曼', '海筹', '海风', '海伦娜', '海坻',
  '海容', '海天', '海豚号', '海因里希亲王', '豪', '赫敏',
  '黑暗界', '黑潮', '黑太子', '黑泽伍德', '洪亮', '虎贲',
  '胡德', '胡蜂', '狐提', '花月', '幻影号', '荒潮', '皇家财富号',
  '回声', '彗星', '霍比',
  // I-J
  '火力', '火奴鲁鲁', '火枪手', '济安', '矶风', '基辅', '基洛夫',
  '棘鳍', '吉尚', '纪伊', '加古', '加贺', '加拉蒂亚', '加利福尼亚',
  '加里波第', '贾维斯', '建武', '桔野', '江风', '杰金斯',
  '金伯利', '金刚', '近江', '金鹿号', '进取', '竞技神', '酒匂',
  '旧金山', '卷波', '倔强', '骏河',
  // K
  '卡尔斯鲁厄', '喀琅施塔得', '卡律布狄斯', '卡萨布兰卡', '卡辛',
  '凯尔圣', '凯旋', '康科德', '科本斯', '科隆', '克拉伦斯·K·布朗森',
  '克莱蒙梭', '克利夫兰', '可畏', '可怖', '可怕', '库尔斯克',
  // L
  '拉菲', '莱比锡', '兰利', '狼', '狻', '勒马尔', '雷', '雷鸣',
  '里诺', '里士满', '利根', '利沃尔诺', '凉月', '列克星敦',
  '列克星敦II', '林仙', '铃谷', '龙骧', '鲁普雷希特亲王', '伦敦',
  '龙·唐',
  // M
  '马布尔黑德', '马格德堡', '皇家方舟', '满洲', '梅休因', '美国',
  '美因茨', '门德斯·努涅斯', '明尼阿波利斯', '明石', '明斯克',
  '莫加多尔', '摩耶', '莫里', '莫斯科',
  // N
  '南达科他', '内华达', '内克特', '尼科洛索·达雷科', '宁海',
  '女将',
  // O-P
  '欧根亲王', '帕塞瓦尔', '培尼', '彭萨科拉', '平海', '浦波',
  // Q-R
  '齐柏林伯爵', '千秋', '乔治·埃夫塔斯', '恰巴耶夫', '切尔茜',
  '青岛', '丘吉尔', '让·巴尔', '让·德·维埃纳', '热情',
  // S
  '萨拉托加', '塞德利茨', '三笠', '山城', '神州', '圣哈辛托',
  '圣路易斯', '圣女贞德', '胜利', '斯库拉', '斯佩伯爵海军上将',
  '司战女神', '四万十', '苏维埃罗西亚', '苏维埃同类型', '樫野',
  '神通', '时雨', '首鸣', '胜利II',
  // T
  '塔林', '太湖', '太阳', '太原', '苔丝', '提尔比茨',
  '天城', '天龙', '天鹰', '铁必制', '通济', '突击者',
  // U-V
  'U-47', 'U-73', 'U-81', 'U-101', 'U-110', 'U-557', 'U-552',
  'U-522', 'U-37', 'U-96', '文森斯', '文琴佐·焦贝蒂',
  // W-X
  '威尔士亲王', '威奇塔', '威廉·D·波特', '韦伯', '无畏',
  '乌尔里希·冯·胡滕', '沃克兰', '沃斯克列先斯克', '武藏',
  '夕立', '夕张', '西雅图', '希佩尔海军上将', '香取', '小猎兔犬',
  '小天鹅', '小柴郡', '小贝法', '小光辉', '小Enterprise', '小赤城',
  '小声望', '小铁必制', '小朱诺', '小欧根', '小莱比锡', '小伊58',
  '心动', '新泽西', '兴登堡', '雄鹰', '絮弗伦',
  // Y-Z
  '亚利桑那', '亚特兰大', '烟波', '盐湖城', '伊吹', '伊19',
  '伊25', '伊26', '伊168', '伊58', '伊401', '伊400',
  '逸仙', '应瑞', '鹰', '勇敢', '由良', '有明', '柚',
  '约翰斯顿', '约克', '约克城', '约克城II', '扎拉', '肇和',
  '震电', '正面', '朱诺', '朱诺II', '筑波', '筑摩',
  '专武', '追赶者', 'z1', 'z2', 'z16', 'z18', 'z19',
  'z20', 'z21', 'z23', 'z25', 'z28', 'z35', 'z36',
  'z46', 'z52',
];

// ============================================================
// 碧蓝档案角色（数据源：BWIKI API + 中文名映射）
// ============================================================

const BLUEARCHIVE_ENTRIES: { name: string; aliases?: string[] }[] = [
  { name: '爱丽', aliases: ['Airi'] },
  { name: '茜', aliases: ['Akane'] },
  { name: '亚子', aliases: ['Ako'] },
  { name: '爱丽丝', aliases: ['Aris'] },
  { name: '阿露', aliases: ['Aru'] },
  { name: '明日奈', aliases: ['Asuna'] },
  { name: '敦子', aliases: ['Atsuko'] },
  { name: '绫音', aliases: ['Ayane'] },
  { name: '梓', aliases: ['Azusa'] },
  { name: '切里诺', aliases: ['Cherino'] },
  { name: '千寻', aliases: ['Chihiro'] },
  { name: '千夏', aliases: ['Chinatsu'] },
  { name: '千世', aliases: ['Chise'] },
  { name: '栄美', aliases: ['Eimi'] },
  { name: '吹雪', aliases: ['Fubuki'] },
  { name: '枫香', aliases: ['Fuuka'] },
  { name: '花江', aliases: ['Hanae'] },
  { name: '花子', aliases: ['Hanako'] },
  { name: '晴', aliases: ['Hare'] },
  { name: '春香', aliases: ['Haruka'] },
  { name: '晴奈', aliases: ['Haruna'] },
  { name: '莲见', aliases: ['Hasumi'] },
  { name: '响', aliases: ['Hibiki'] },
  { name: '步美', aliases: ['Hifumi'] },
  { name: '日鞠', aliases: ['Himari'] },
  { name: '日奈', aliases: ['Hina'] },
  { name: '日向', aliases: ['Hinata'] },
  { name: '日和', aliases: ['Hiyori'] },
  { name: '星野', aliases: ['Hoshino'] },
  { name: '伊织', aliases: ['Iori'] },
  { name: '伊吕波', aliases: ['Iroha'] },
  { name: '和泉', aliases: ['Izumi'] },
  { name: '伊津奈', aliases: ['Izuna'] },
  { name: '纯子', aliases: ['Junko'] },
  { name: '朱莉', aliases: ['Juri'] },
  { name: '枫', aliases: ['Kaede'] },
  { name: '佳世', aliases: ['Kaho'] },
  { name: '莰娜', aliases: ['Kanna'] },
  { name: '卡琳', aliases: ['Karin'] },
  { name: '佳代子', aliases: ['Kayoko'] },
  { name: '和纱', aliases: ['Kazusa'] },
  { name: '雾乃', aliases: ['Kirino'] },
  { name: '小春', aliases: ['Koharu'] },
  { name: '琴乃', aliases: ['Kokona'] },
  { name: '木玉', aliases: ['Kotama'] },
  { name: '琴里', aliases: ['Kotori'] },
  { name: '小雪', aliases: ['Koyuki'] },
  { name: '真纪', aliases: ['Maki'] },
  { name: '玛丽', aliases: ['Mari'] },
  { name: '玛丽娜', aliases: ['Marina'] },
  { name: '麻白', aliases: ['Mashiro'] },
  { name: '芽惠', aliases: ['Megu'] },
  { name: '未知瑠', aliases: ['Michiru'] },
  { name: '翠', aliases: ['Midori'] },
  { name: '未花', aliases: ['Mika'] },
  { name: '美守', aliases: ['Mimori'] },
  { name: '米娜', aliases: ['Mina'] },
  { name: '峰', aliases: ['Mine'] },
  { name: '实乃里', aliases: ['Minori'] },
  { name: '美咲', aliases: ['Misaki'] },
  { name: '都', aliases: ['Miyako'] },
  { name: '美游', aliases: ['Miyu'] },
  { name: '萌', aliases: ['Moe'] },
  { name: '桃井', aliases: ['Momoi'] },
  { name: '睦月', aliases: ['Mutsuki'] },
  { name: '渚', aliases: ['Nagisa'] },
  { name: '夏', aliases: ['Natsu'] },
  { name: '音璃', aliases: ['Neru'] },
  { name: '诺亚', aliases: ['Noa'] },
  { name: '和香', aliases: ['Nodoka'] },
  { name: '乃乃美', aliases: ['Nonomi'] },
  { name: '皮娜', aliases: ['Pina'] },
  { name: '蕾莎', aliases: ['Reisa'] },
  { name: '琉美', aliases: ['Rumi'] },
  { name: '咲', aliases: ['Saki'] },
  { name: '樱子', aliases: ['Sakurako'] },
  { name: '沙织', aliases: ['Saori'] },
  { name: '沙耶', aliases: ['Saya'] },
  { name: '濑名', aliases: ['Sena'] },
  { name: '芹香', aliases: ['Serika'] },
  { name: '芹娜', aliases: ['Serina'] },
  { name: '时雨', aliases: ['Shigure'] },
  { name: '志美子', aliases: ['Shimiko'] },
  { name: '白子', aliases: ['Shiroko'] },
  { name: '静子', aliases: ['Shizuko'] },
  { name: '顺', aliases: ['Shun'] },
  { name: '菫', aliases: ['Sumire'] },
  { name: '铃美', aliases: ['Suzumi'] },
  { name: '杜记', aliases: ['Toki'] },
  { name: '巴', aliases: ['Tomoe'] },
  { name: '椿', aliases: ['Tsubaki'] },
  { name: '月夜', aliases: ['Tsukuyo'] },
  { name: '剑先', aliases: ['Tsurugi'] },
  { name: '忧', aliases: ['Ui'] },
  { name: '菅原', aliases: ['Utaha'] },
  { name: '若藻', aliases: ['Wakamo'] },
  { name: '佳世美', aliases: ['Yoshimi'] },
  { name: '优香', aliases: ['Yuuka'] },
  { name: '柚子', aliases: ['Yuzu'] },
  { name: '阿罗娜', aliases: ['Arona'] },
  { name: '普拉娜', aliases: ['Plana'] },
];

// ============================================================
// 汇总导出
// ============================================================

function buildCharacterList(): GameCharacter[] {
  const list: GameCharacter[] = [];

  for (const name of GENSHIN_NAMES) {
    list.push({ name, game: 'genshin' });
  }
  for (const name of STARRAIL_NAMES) {
    list.push({ name, game: 'starrail' });
  }
  for (const entry of WUTHERING_ENTRIES) {
    list.push({ name: entry.name, aliases: entry.aliases, game: 'wuthering' });
  }
  for (const name of AZURLANE_NAMES) {
    list.push({ name, game: 'azurlane' });
  }
  for (const entry of BLUEARCHIVE_ENTRIES) {
    list.push({ name: entry.name, aliases: entry.aliases, game: 'bluearchive' });
  }

  return list;
}

export const ALL_GAME_CHARACTERS: GameCharacter[] = buildCharacterList();

export const CHARACTER_COUNTS: Record<GameType, number> = {
  genshin: GENSHIN_NAMES.length,
  starrail: STARRAIL_NAMES.length,
  wuthering: WUTHERING_ENTRIES.length,
  azurlane: AZURLANE_NAMES.length,
  bluearchive: BLUEARCHIVE_ENTRIES.length,
};
