// wiki-scraper updates game character JSON files from Bilibili Wiki
// using chromedp (headless browser) to bypass Cloudflare anti-bot.
//
// Usage:
//
//	go run ./cmd/wiki-scraper          # scrape all games
//	go run ./cmd/wiki-scraper sr       # scrape Star Rail only
//	go run ./cmd/wiki-scraper sr ys    # scrape SR + Genshin
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/chromedp/chromedp"

	"backend/internal/infra"
)

type gameConfig struct {
	Name       string
	NameEn     string
	ShortNames []string
	WikiBase   string // e.g. "https://wiki.biligame.com/sr"
	ListPage   string // e.g. "/角色一览"
	OutFile    string
}

var games = map[string]gameConfig{
	"sr": {
		Name: "崩坏：星穹铁道", NameEn: "Honkai: Star Rail",
		ShortNames: []string{"星穹铁道", "崩铁", "HSR"},
		WikiBase: "https://wiki.biligame.com/sr", ListPage: "/角色一览",
		OutFile: "honkai-star-rail.json",
	},
	"ys": {
		Name: "原神", NameEn: "Genshin Impact",
		ShortNames: []string{"Genshin", "GI"},
		WikiBase: "https://wiki.biligame.com/ys", ListPage: "/角色",
		OutFile: "genshin-impact.json",
	},
	"blhx": {
		Name: "碧蓝航线", NameEn: "Azur Lane",
		ShortNames: []string{"碧蓝", "AL"},
		WikiBase: "https://wiki.biligame.com/blhx", ListPage: "/舰娘图鉴",
		OutFile: "azur-lane.json",
	},
	"ba": {
		Name: "碧蓝档案", NameEn: "Blue Archive",
		ShortNames: []string{"BA"},
		WikiBase: "https://wiki.biligame.com/ba", ListPage: "/学生图鉴",
		OutFile: "blue-archive.json",
	},
	"ak": {
		Name: "明日方舟", NameEn: "Arknights",
		ShortNames: []string{"方舟", "AK"},
		WikiBase: "https://wiki.biligame.com/arknights", ListPage: "/干员图鉴",
		OutFile: "arknights.json",
	},
}

func main() {
	logger := infra.NewLogger("WikiScraper")
	targets := []string{}
	for _, arg := range os.Args[1:] {
		if _, ok := games[arg]; ok {
			targets = append(targets, arg)
		}
	}
	if len(targets) == 0 {
		// Default: all games
		for k := range games {
			targets = append(targets, k)
		}
	}
	logger.Info("Targets", infra.LogContext{Extra: map[string]any{"targets": targets}})

	outputDir := "resources/game"
	_ = os.MkdirAll(outputDir, 0755)

	for _, key := range targets {
		cfg := games[key]
		logger.Info("Scraping game", infra.LogContext{Extra: map[string]any{"game": cfg.Name}})
		chars, err := scrapeWithChromeDP(cfg)
		if err != nil {
			logger.Error("Scrape failed", infra.LogContext{Extra: map[string]any{"error": err.Error()}})
			continue
		}
		logger.Info("Characters extracted", infra.LogContext{Extra: map[string]any{"count": len(chars)}})

		output := map[string]any{
			"name":       cfg.Name,
			"nameEn":     cfg.NameEn,
			"shortNames": cfg.ShortNames,
			"characters": chars,
		}

		path := outputDir + "/" + cfg.OutFile
		b, _ := json.MarshalIndent(output, "", "  ")
		os.WriteFile(path, b, 0644)
		logger.Info("File written", infra.LogContext{Extra: map[string]any{"path": path}})
	}
	logger.Info("Done")
}

type charEntry struct {
	Name    string   `json:"name"`
	Pinyin  string   `json:"pinyin"`
	Aliases []string `json:"aliases"`
}

func scrapeWithChromeDP(cfg gameConfig) ([]charEntry, error) {
	ctx, cancel := chromedp.NewContext(context.Background())
	defer cancel()

	ctx, cancel2 := context.WithTimeout(ctx, 60*time.Second)
	defer cancel2()

	url := cfg.WikiBase + cfg.ListPage
	var html string
	err := chromedp.Run(ctx,
		chromedp.Navigate(url),
		chromedp.Sleep(3*time.Second), // wait for JS render
		chromedp.OuterHTML("html", &html),
	)
	if err != nil {
		return nil, fmt.Errorf("navigate: %w", err)
	}

	return parseCharListHTML(html, cfg), nil
}

func parseCharListHTML(html string, cfg gameConfig) []charEntry {
	// Extract all wiki links that look like character pages
	// Pattern: <a href="/XX/角色名" title="角色名">角色名</a>
	linkRe := regexp.MustCompile(`<a[^>]*href="/[^"]*/([^"/]+)"[^>]*title="([^"]*)"[^>]*>`)
	matches := linkRe.FindAllStringSubmatch(html, -1)

	seen := make(map[string]bool)
	var chars []charEntry

	skipPrefixes := []string{"角色", "模板", "文件", "分类", "帮助", "特殊","Category","Template","File","MediaWiki","Widget","属性","命途","未实装"}
	skipWords := []string{"一览","图鉴","筛选","速查","攻略","材料","语音","故事","背景","技能","星魂","光锥","遗器","","导航","首页"}

	for _, m := range matches {
		name := strings.TrimSpace(m[2])
		if name == "" || seen[name] {
			continue
		}
		if len(name) == 0 || len(name) > 20 {
			continue
		}

		skip := false
		lower := strings.ToLower(name)
		for _, p := range skipPrefixes {
			if strings.HasPrefix(lower, strings.ToLower(p)) {
				skip = true
				break
			}
		}
		for _, w := range skipWords {
			if strings.Contains(name, w) {
				skip = true
				break
			}
		}
		if skip {
			continue
		}

		seen[name] = true
		chars = append(chars, charEntry{Name: name})
	}

	return chars
}
