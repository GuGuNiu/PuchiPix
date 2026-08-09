package titleparser

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestParser(t *testing.T) *Parser {
	t.Helper()
	p := New()

	// Load test models (subset of real data)
	models := []ModelEntry{
		{Name: "NAGISA魔物喵", Pinyin: "NAGISA mowumiao", Aliases: []string{"NAGISA", "魔物喵"}},
		{Name: "蠢沫沫", Pinyin: "chun momo", Aliases: []string{"蠢沫", "沫沫"}},
		{Name: "奶桃桃", Pinyin: "nai taotao", Aliases: []string{"奶桃"}},
		{Name: "云溪溪", Pinyin: "yun xixi", Aliases: []string{"云溪"}},
		{Name: "面饼仙儿", Pinyin: "mianbing xianer", Aliases: []string{"面饼", "仙儿"}},
		{Name: "半半子", Pinyin: "banbanzi", Aliases: []string{"半半"}},
		{Name: "哎我黑切讷", Pinyin: "ai wo heiqiene", Aliases: []string{"黑切讷"}},
		{Name: "咬一口兔娘", Pinyin: "yaoyikou tuniang", Aliases: []string{"兔娘", "ovo"}},
		{Name: "Natsuko夏夏子", Pinyin: "Natsuko xiaxizi", Aliases: []string{"Natsuko", "夏夏子"}},
		{Name: "九柒喵", Pinyin: "jiuqi miao", Aliases: []string{"九柒"}},
		{Name: "KANEKO咔喵", Pinyin: "KANEKO kamiao", Aliases: []string{"KANEKO", "咔喵"}},
		{Name: "上杉绘梨落", Pinyin: "shangshan huililuo", Aliases: []string{"上杉"}},
		{Name: "Yiko湿润兔", Pinyin: "Yiko shiruntu", Aliases: []string{"Yiko", "湿润兔"}},
		{Name: "Machi馬吉", Pinyin: "Machi maji", Aliases: []string{"Machi", "馬吉"}},
		{Name: "三度_69", Pinyin: "sandu 69", Aliases: []string{"三度"}},
		{Name: "Cat_Demon你的喵崽", Pinyin: "Cat Demon nide miaozai", Aliases: []string{"Cat_Demon", "你的喵崽"}},
		{Name: "Bangni邦尼", Pinyin: "Bangni bangni", Aliases: []string{"Bangni", "邦尼"}},
		{Name: "刺卜(连连)", Pinyin: "ci bu lianlian", Aliases: []string{"刺卜", "连连", "cibu"}},
	}
	p.LoadModels(models)

	// Load game characters (subset)
	gameChars := []GameCharEntry{
		{Name: "卡芙卡", Pinyin: "kafuka", Aliases: []string{"Kafka", "卡夫卡"}, GameName: "崩坏：星穹铁道", GameEn: "Honkai: Star Rail"},
		{Name: "花火", Pinyin: "huahuo", Aliases: []string{"Sparkle", "火花"}, GameName: "崩坏：星穹铁道", GameEn: "Honkai: Star Rail"},
		{Name: "昔涟", Pinyin: "xilian", Aliases: []string{"Cyrene"}, GameName: "崩坏：星穹铁道", GameEn: "Honkai: Star Rail"},
		{Name: "雷电将军", Pinyin: "leidian jiangjun", Aliases: []string{"Raiden Shogun", "雷神"}, GameName: "原神", GameEn: "Genshin Impact"},
		{Name: "八重神子", Pinyin: "bachong shenzi", Aliases: []string{"Yae Miko", "八重"}, GameName: "原神", GameEn: "Genshin Impact"},
		{Name: "夜兰", Pinyin: "yelan", Aliases: []string{"Yelan"}, GameName: "原神", GameEn: "Genshin Impact"},
		{Name: "可畏", Pinyin: "kewei", Aliases: []string{"Formidable"}, GameName: "碧蓝航线", GameEn: "Azur Lane"},
		{Name: "柴郡", Pinyin: "chaijun", Aliases: []string{"Cheshire"}, GameName: "碧蓝航线", GameEn: "Azur Lane"},
		{Name: "明日奈", Pinyin: "mingrinai", Aliases: []string{"Asuna"}, GameName: "碧蓝档案", GameEn: "Blue Archive"},
		{Name: "2B", Pinyin: "2B", Aliases: []string{"2B小姐姐", "2B本"}, GameName: "尼尔：机械纪元", GameEn: "NieR: Automata"},
	}
	p.LoadGameCharacters(gameChars)

	return p
}

// ── Normal titles ──

func TestParse_NAGISAMonsterCat_MaidNight(t *testing.T) {
	// Input:  "NAGISA魔物喵 - 女仆之夜"
	// Expected protagonist: "NAGISA魔物喵"
	p := newTestParser(t)
	result := p.Parse("NAGISA魔物喵 - 女仆之夜")

	assert.Equal(t, "NAGISA魔物喵", result.Protagonist)
	assert.Contains(t, result.Description, "女仆之夜")
	assert.True(t, result.Confidence > 0, "should have some confidence")
}

func TestParse_ChunMomo_Twintails(t *testing.T) {
	// Input:  "双马尾 - 蠢沫沫奇遇记_102P_写真合集"
	// Expected protagonist: "蠢沫沫" (regression: must not detect 双马尾)
	p := newTestParser(t)
	result := p.Parse("双马尾 - 蠢沫沫奇遇记_102P_写真合集")

	assert.Equal(t, "蠢沫沫", result.Protagonist,
		"should detect 蠢沫沫 as model, not 双马尾")
	assert.NotContains(t, result.Protagonist, "双马尾")
}

// ── Dual-person titles ──

func TestParse_NaiTaotao_YunXixi_2B(t *testing.T) {
	// Input:  "奶桃桃 - 云溪溪_-_2B本"
	// Expected protagonist: "奶桃桃与云溪溪"
	p := newTestParser(t)
	result := p.Parse("奶桃桃 - 云溪溪_-_2B本")

	assert.Contains(t, result.Protagonist, "奶桃桃")
	assert.Contains(t, result.Protagonist, "云溪溪")
	// 2B should be detected as game character
	assert.Contains(t, result.GameCharacters, "2B")
}

func TestParse_MianBing_BanBanZi(t *testing.T) {
	// Input:  "面饼仙儿 - 与半半子_可畏兔兔_Cosplay"
	// Expected protagonist: "面饼仙儿与半半子"
	p := newTestParser(t)
	result := p.Parse("面饼仙儿 - 与半半子_可畏兔兔_Cosplay")

	assert.Contains(t, result.Protagonist, "面饼仙儿")
	assert.Contains(t, result.Protagonist, "半半子",
		"should detect 半半子 via '与' pattern")
	// 可畏 should be detected as game character
	assert.Contains(t, result.GameCharacters, "可畏")
}

// ── Complex long titles ──

func TestParse_AiWoHeiQieNe(t *testing.T) {
	// Input:  "哎我黑切讷_-_崩坏星穹铁道_火花：崩坏星穹铁道_火花角色还原美腿大尺度_34P7V"
	// Expected protagonist: "哎我黑切讷"
	p := newTestParser(t)
	result := p.Parse("哎我黑切讷_-_崩坏星穹铁道_火花：崩坏星穹铁道_火花角色还原美腿大尺度_34P7V")

	assert.Equal(t, "哎我黑切讷", result.Protagonist,
		"should detect 哎我黑切讷 as model")
	assert.Contains(t, result.GameCharacters, "花火",
		"should detect 花火 (Sparkle) as game character")
	// Description may be empty when all segments are classified
	assert.GreaterOrEqual(t, len(result.Segments), 2,
		"should have multiple segments")
}

// ── Additional edge cases ──

func TestParse_SingleModelGameChar(t *testing.T) {
	// "Natsuko夏夏子 - 原神夜兰兔女郎"
	p := newTestParser(t)
	result := p.Parse("Natsuko夏夏子 - 原神夜兰兔女郎")

	assert.Contains(t, result.Protagonist, "Natsuko夏夏子")
	assert.Contains(t, result.GameCharacters, "夜兰")
}

func TestParse_DualModelBySeparator(t *testing.T) {
	// "Machi馬吉 - Kafka卡芙卡_星穹铁道"
	p := newTestParser(t)
	result := p.Parse("Machi馬吉 - Kafka卡芙卡_星穹铁道")

	assert.Contains(t, result.Protagonist, "Machi馬吉")
	assert.Contains(t, result.GameCharacters, "卡芙卡")
}

func TestParse_OnlyPhotoCount(t *testing.T) {
	// Edge case: only count info, no model
	p := newTestParser(t)
	result := p.Parse("102P_写真合集")

	assert.Empty(t, result.Protagonist)
	assert.Empty(t, result.GameCharacters)
}

func TestParse_EmptyTitle(t *testing.T) {
	p := newTestParser(t)
	result := p.Parse("")
	assert.Empty(t, result.Protagonist)
	assert.Empty(t, result.Description)
}

func TestParse_WhitespaceOnly(t *testing.T) {
	p := newTestParser(t)
	result := p.Parse("   ")
	assert.Empty(t, result.Protagonist)
}

func TestParse_KANEKO_Kamiao_Cheshire(t *testing.T) {
	// "KANEKO_咔喵 - 碧蓝航线_可畏兔女郎"
	p := newTestParser(t)
	result := p.Parse("KANEKO_咔喵 - 碧蓝航线_可畏兔女郎")

	assert.Contains(t, result.Protagonist, "KANEKO咔喵")
	assert.Contains(t, result.GameCharacters, "可畏")
}

func TestParse_YikoShiRunTu_Asuna(t *testing.T) {
	// "Yiko湿润兔 - 碧蓝档案_明日奈兔女郎"
	p := newTestParser(t)
	result := p.Parse("Yiko湿润兔 - 碧蓝档案_明日奈兔女郎")

	assert.Contains(t, result.Protagonist, "Yiko湿润兔")
	assert.Contains(t, result.GameCharacters, "明日奈")
}

func TestParse_NineCat_CheshireSwimsuit(t *testing.T) {
	// "九柒喵 - 碧蓝航线_柴郡泳装"
	p := newTestParser(t)
	result := p.Parse("九柒喵 - 碧蓝航线_柴郡泳装")

	assert.Contains(t, result.Protagonist, "九柒喵")
	assert.Contains(t, result.GameCharacters, "柴郡")
}

func TestParse_Sandu69_Asuna(t *testing.T) {
	// "三度_69_-_蔚蓝档案_明日奈"
	p := newTestParser(t)
	result := p.Parse("三度_69_-_蔚蓝档案_明日奈")

	assert.Contains(t, result.Protagonist, "三度_69")
	assert.Contains(t, result.GameCharacters, "明日奈")
}

func TestParse_YaoYiKouTuNiang_YaeMiko(t *testing.T) {
	// "咬一口兔娘 - ovo-八重神子"
	p := newTestParser(t)
	result := p.Parse("咬一口兔娘 - ovo-八重神子")

	assert.Contains(t, result.Protagonist, "咬一口兔娘")
	assert.Contains(t, result.GameCharacters, "八重神子")
}

func TestParse_ShangShan_Raiden(t *testing.T) {
	// "上杉绘梨落 - 雷电将军同人"
	p := newTestParser(t)
	result := p.Parse("上杉绘梨落 - 雷电将军同人")

	assert.Contains(t, result.Protagonist, "上杉绘梨落")
	assert.Contains(t, result.GameCharacters, "雷电将军")
}

func TestParse_CatDemon_AsunaCosplay(t *testing.T) {
	// "Cat_Demon你的喵崽明日奈兔女郎_Cosplay"
	p := newTestParser(t)
	result := p.Parse("Cat_Demon你的喵崽明日奈兔女郎_Cosplay")

	assert.Contains(t, result.Protagonist, "Cat_Demon你的喵崽")
	assert.Contains(t, result.GameCharacters, "明日奈")
}

// ── JSON loading tests ──

func TestLoadModelsFromJSON(t *testing.T) {
	jsonData := []byte(`{"version":"1.0","models":[{"name":"测试模特","pinyin":"ceshi mote","aliases":["测试"]}]}`)

	models, err := LoadModelsFromJSON(jsonData)
	require.NoError(t, err)
	require.Len(t, models, 1)
	assert.Equal(t, "测试模特", models[0].Name)
	assert.Equal(t, "ceshi mote", models[0].Pinyin)
	assert.Equal(t, []string{"测试"}, models[0].Aliases)
}

func TestLoadGameCharactersFromJSON(t *testing.T) {
	jsonData := []byte(`{"name":"测试游戏","nameEn":"Test Game","characters":[{"name":"测试角色","pinyin":"ceshi juese","aliases":["角色"]}]}`)

	chars, err := LoadGameCharactersFromJSON(jsonData)
	require.NoError(t, err)
	require.Len(t, chars, 1)
	assert.Equal(t, "测试角色", chars[0].Name)
	assert.Equal(t, "测试游戏", chars[0].GameName)
	assert.Equal(t, "Test Game", chars[0].GameEn)
}

func TestLoadModelsFromJSON_Invalid(t *testing.T) {
	_, err := LoadModelsFromJSON([]byte(`not json`))
	assert.Error(t, err)
}

func TestLoadGameCharactersFromJSON_Invalid(t *testing.T) {
	_, err := LoadGameCharactersFromJSON([]byte(`{`))
	assert.Error(t, err)
}

// ── Unknown model heuristic extraction ──

func TestParse_CiBuLianLian_UnknownModel(t *testing.T) {
	// Input:  "刺卜(连连) - 白虎私拍合集_#01：黑白丝袜猫娘露点"
	// Expected: heuristic should detect "刺卜(连连)" as unknown model name
	// (placed before the first hyphen separator)
	p := newTestParser(t)
	result := p.Parse("刺卜(连连) - 白虎私拍合集_#01：黑白丝袜猫娘露点")

	t.Logf("Protagonist: '%s'", result.Protagonist)
	t.Logf("Description: '%s'", result.Description)
	t.Logf("Confidence: %.2f", result.Confidence)
	t.Logf("Segments: %v", result.Segments)
	t.Logf("GameChars: %v", result.GameCharacters)

	assert.Equal(t, "刺卜(连连)", result.Protagonist,
		"should detect 刺卜(连连) as unknown model via heuristic fallback")
	assert.Empty(t, result.GameCharacters)
}

func TestParse_CiBuLianLian_Segments(t *testing.T) {
	// Verify segmentation: the model name with parentheses "刺卜(连连)"
	// should be correctly segmented as the first segment.
	title := "刺卜(连连) - 白虎私拍合集_#01：黑白丝袜猫娘露点"

	p := New()
	segments := p.smartSegment(title)

	t.Logf("Segments (%d): %v", len(segments), segments)
	for i, seg := range segments {
		t.Logf("  seg[%d] = '%s' (plausibleModel: %v)", i, seg, isPlausibleModelName(seg))
	}

	assert.Len(t, segments, 3, "should split into 3 segments")
	assert.Equal(t, "刺卜(连连)", segments[0])
	assert.Equal(t, "白虎私拍合集_#01", segments[1])
	assert.Equal(t, "黑白丝袜猫娘露点", segments[2])
}

// ── Benchmark ──

func BenchmarkParse(b *testing.B) {
	p := newTestParser(&testing.T{})
	title := "哎我黑切讷_-_崩坏星穹铁道_火花：崩坏星穹铁道_火花角色还原美腿大尺度_34P7V"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		p.Parse(title)
	}
}

