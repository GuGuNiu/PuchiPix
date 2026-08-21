package api

import (
	"testing"

	"backend/internal/api/internal/task_compute"
)

func TestStripPersonFromTitle(t *testing.T) {
	tests := []struct {
		name     string
		title    string
		person   string
		expected string
	}{
		// ── Original test cases (backward compatibility) ──
		{
			name:     "gallery title with protagonist prefix",
			title:    "Machi馬吉 - Kafka卡芙卡 星穹铁道 21P1V",
			person:   "Machi馬吉",
			expected: "Kafka卡芙卡 星穹铁道 21P1V",
		},
		{
			name:     "title with em-dash separator",
			title:    "珟_珏Dita — 美味圣诞B档 176P",
			person:   "珟_珏Dita",
			expected: "美味圣诞B档 176P",
		},
		{
			name:     "title equals person name only",
			title:    "Machi馬吉",
			person:   "Machi馬吉",
			expected: "Machi馬吉", // should not return empty
		},
		{
			name:     "title does not start with person",
			title:    "Kafka卡芙卡 星穹铁道",
			person:   "Machi馬吉",
			expected: "Kafka卡芙卡 星穹铁道",
		},
		{
			name:     "empty title",
			title:    "",
			person:   "Someone",
			expected: "",
		},
		{
			name:     "empty person",
			title:    "Some Title",
			person:   "",
			expected: "Some Title",
		},
		{
			name:     "comma-separated persons, first matches",
			title:    "ActorA - Some Content",
			person:   "ActorA, ActorB",
			expected: "Some Content",
		},
		{
			name:     "comma-separated persons, second matches",
			title:    "ActorB - Some Content",
			person:   "ActorA, ActorB",
			expected: "Some Content",
		},
		{
			name:     "Chinese name with dash",
			title:    "面饼仙儿 - 碧蓝航线 柴郡 礼服",
			person:   "面饼仙儿",
			expected: "碧蓝航线 柴郡 礼服",
		},
		{
			name:     "title with colon separator",
			title:    "清水由乃: 米哈拉",
			person:   "清水由乃",
			expected: "米哈拉",
		},
		{
			name:     "video title that doesn't contain actor",
			title:    "青岛大学生被掌掴臀部仍迎合抽插",
			person:   "善場まみ",
			expected: "青岛大学生被掌掴臀部仍迎合抽插",
		},

		// ── New: Site-added prefix stripping ──
		{
			name:     "bracket prefix [私房]",
			title:    "[私房] Pudding - 白虎口罩私拍：福利姬美腿视频 218P70V",
			person:   "Pudding",
			expected: "白虎口罩私拍：福利姬美腿视频 218P70V",
		},
		{
			name:     "bracket prefix [cosplay]",
			title:    "[cosplay] 芝心蛋奶烧 - 碧蓝航线 云仙：碧蓝航线 云仙旗袍角色还原美腿 300P5V",
			person:   "芝心蛋奶烧",
			expected: "碧蓝航线 云仙：碧蓝航线 云仙旗袍角色还原美腿 300P5V",
		},
		{
			name:     "bracket prefix [爱妹子]",
			title:    "[爱妹子] 雪晴Astra - JK制服私房",
			person:   "雪晴Astra",
			expected: "JK制服私房",
		},
		{
			name:     "site prefix 动漫博主",
			title:    "动漫博主阿包也是兔娘 - 原神中二皇女",
			person:   "阿包也是兔娘",
			expected: "原神中二皇女",
		},
		{
			name:     "site prefix COS福利",
			title:    "COS福利rioko凉凉子 - 大凤",
			person:   "rioko凉凉子",
			expected: "大凤",
		},
		{
			name:     "site prefix 森萝财团",
			title:    "森萝财团：理万姬 - 蒙眼寻路SM露出游戏 47P",
			person:   "理万姬",
			expected: "蒙眼寻路SM露出游戏 47P",
		},
		{
			name:     "site prefix No.XXXX",
			title:    "No.4164 苏小曼babyface",
			person:   "苏小曼",
			expected: "babyface",
		},
		{
			name:     "site prefix 微博妹子",
			title:    "微博妹子三度_69 - 白丝芭蕾",
			person:   "三度_69",
			expected: "白丝芭蕾",
		},
		{
			name:     "site prefix 人气Coser",
			title:    "人气Coser二佐Nisa - fate黑枪呆万圣节",
			person:   "二佐Nisa",
			expected: "fate黑枪呆万圣节",
		},
		{
			name:     "site prefix Cosplay",
			title:    "Cosplay日奈娇 - 黑丝紧束",
			person:   "日奈娇",
			expected: "黑丝紧束",
		},
		{
			name:     "site prefix COS萌妹",
			title:    "COS萌妹沧霁桔梗 - 麻衣学姐",
			person:   "沧霁桔梗",
			expected: "麻衣学姐",
		},
		{
			name:     "site prefix 萌妹",
			title:    "萌妹奈汐酱nice - 过年胖了20斤！",
			person:   "奈汐酱nice",
			expected: "过年胖了20斤！",
		},
		{
			name:     "site prefix 尤物",
			title:    "尤物清水由乃 - 爱宕兔女郎",
			person:   "清水由乃",
			expected: "爱宕兔女郎",
		},
		{
			name:     "site prefix NinJA",
			title:    "NinJA阿寨寨 - 肉肉大白兔",
			person:   "NinJA阿寨寨",
			expected: "肉肉大白兔",
		},
		{
			name:     "site prefix 微博正妹像个",
			title:    "微博正妹像个傻依 -学妹黑丝",
			person:   "傻依",
			expected: "学妹黑丝",
		},

		// ── New: Dual-person separator normalization ──
		{
			name:     "dual-person & separator (spaces)",
			title:    "九曲Jean & 二佐Nisa 幽灵娘 50P1V",
			person:   "九曲Jean与二佐Nisa",
			expected: "幽灵娘 50P1V",
		},
		{
			name:     "dual-person & separator (no spaces)",
			title:    "蛋蛋宝&袁圆 - 清纯JK制服 81P1V",
			person:   "蛋蛋宝与袁圆",
			expected: "清纯JK制服 81P1V",
		},
		{
			name:     "dual-person with prefix and & separator",
			title:    "Tina很妖孽呀 &奈奈同学 - 圣诞节限定 82P1V",
			person:   "Tina很妖孽呀与奈奈同学",
			expected: "圣诞节限定 82P1V",
		},
		{
			name:     "dual-person already normalized (与)",
			title:    "面饼仙儿与半半子 可畏兔兔 Cosplay 57P1V",
			person:   "面饼仙儿与半半子",
			expected: "可畏兔兔 Cosplay 57P1V",
		},

		// ── New: Parenthetical suffix stripping ──
		{
			name:     "parenthetical suffix after name",
			title:    "蠢沫沫 (chunmomo) - 宴：宴会私房 35P",
			person:   "蠢沫沫",
			expected: "宴：宴会私房 35P",
		},
		{
			name:     "parenthetical suffix no space",
			title:    "玉宝涩涩(水手服彼女飼育) - 白虎水手服订阅：私拍视频 44P23V",
			person:   "玉宝涩涩",
			expected: "白虎水手服订阅：私拍视频 44P23V",
		},

		// ── New: Combined cases ──
		{
			name:     "bracket prefix + dual-person & separator",
			title:    "[私房] 李丽莎 LiLiSha & 白茹雪 BaiRuXue - 双人派对主题",
			person:   "李丽莎 LiLiSha与白茹雪 BaiRuXue",
			expected: "双人派对主题",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := task_compute.StripPersonFromTitle(tt.title, tt.person)
			if result != tt.expected {
				t.Errorf("StripPersonFromTitle(%q, %q) = %q, want %q", tt.title, tt.person, result, tt.expected)
			}
		})
	}
}
