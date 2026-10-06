package sites

import (
	"strings"
	"sync"
	"testing"
)

// TestValidateRule ensures invalid match modes, oversized keywords, and
// uncompilable regexes are rejected before save, so a rule that can never
// match does not reach the database.
func TestValidateRule(t *testing.T) {
	tests := []struct {
		name      string
		keyword   string
		matchMode string
		wantErr   bool
	}{
		{"合法 includes 规则", "某个关键词", "includes", false},
		{"合法 exact 规则", "精确匹配", "exact", false},
		{"合法 regex 规则", `^https?://example\.com/.*$`, "regex", false},
		{"空关键词被拒绝", "", "includes", true},
		{"超长关键词被拒绝", strings.Repeat("a", maxKeywordLength+1), "includes", true},
		{"长度上限恰好通过", strings.Repeat("a", maxKeywordLength), "includes", false},
		{"非法匹配模式被拒绝", "keyword", "glob", true},
		{"空匹配模式被拒绝", "keyword", "", true},
		{"非法正则被拒绝", "(unclosed", "regex", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateRule(tt.keyword, tt.matchMode)
			if (err != nil) != tt.wantErr {
				t.Fatalf("ValidateRule(%q, %q) error = %v, wantErr %v",
					tt.keyword, tt.matchMode, err, tt.wantErr)
			}
		})
	}
}

// TestMatchValue verifies consistent behavior across the three match modes,
// especially that an invalid regex rule returns false instead of panicking.
func TestMatchValue(t *testing.T) {
	tests := []struct {
		name  string
		value string
		key   string
		mode  string
		want  bool
	}{
		{"includes 命中", "Hello World", "world", "includes", true},
		{"includes 未命中", "Hello", "xyz", "includes", false},
		{"exact 命中", "精确值", "精确值", "exact", true},
		{"exact 大小写敏感不命中", "Value", "value", "exact", false},
		{"regex 命中（忽略大小写）", "Example.COM Page", `example\.com`, "regex", true},
		{"regex 未命中", "other.org", `example\.com`, "regex", false},
		{"非法正则安全返回 false", "anything", "(unclosed", "regex", false},
		{"未知模式回退为 includes", "Hello World", "hello", "unknown-mode", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := matchValue(tt.value, tt.key, tt.mode)
			if got != tt.want {
				t.Fatalf("matchValue(%q, %q, %q) = %v, want %v",
					tt.value, tt.key, tt.mode, got, tt.want)
			}
		})
	}
}

// TestCompileUserRegexCache checks that concurrent calls for the same pattern
// reuse the cached instance, and that a cached-nil invalid pattern does not
// re-log or panic on repeated calls.
func TestCompileUserRegexCache(t *testing.T) {
	valid := compileUserRegex(`example\.com`)
	if valid == nil {
		t.Fatal("valid pattern compiled to nil")
	}
	again := compileUserRegex(`example\.com`)
	if again != valid {
		t.Fatal("cached pattern returned a different instance (cache miss)")
	}

	invalid := compileUserRegex("(unclosed")
	if invalid != nil {
		t.Fatal("invalid pattern should cache as nil")
	}
	invalidAgain := compileUserRegex("(unclosed")
	if invalidAgain != nil {
		t.Fatal("invalid pattern second call should still be nil")
	}

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if re := compileUserRegex(`concurrent\.test`); re == nil {
				t.Error("concurrent compile returned nil for valid pattern")
			}
		}()
	}
	wg.Wait()
}
