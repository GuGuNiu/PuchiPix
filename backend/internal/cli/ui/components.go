package ui

import (
	"fmt"
	"strings"
)

func PrintDivider(title string) {
	if title == "" {
		fmt.Printf("%s%s%s\n", Dim, strings.Repeat("\u2500", 64), Reset)
		return
	}
	line := strings.Repeat("\u2500", max(0, 60-len(title)-3))
	fmt.Printf("%s\u2500\u2500 %s %s%s\n", Bold, title, line, Reset)
}

// RenderProgressBar renders a bar that turns red at 100% and yellow from 80%
// on, so a saturated bar is distinguishable from a stalled one.
func RenderProgressBar(current, max, barWidth int) string {
	if barWidth <= 0 {
		barWidth = 20
	}
	filled := 0
	if max > 0 {
		filled = (current * barWidth) / max
	}
	bar := strings.Repeat("\u2588", filled) + strings.Repeat("\u2591", maxInt(0, barWidth-filled))
	pct := 0
	if max > 0 {
		pct = (current * 100) / max
	}
	color := Green
	switch {
	case pct >= 100:
		color = Red
	case pct >= 80:
		color = Yellow
	}
	return fmt.Sprintf("%s%s%s %d/%d (%d%%)", color, bar, Reset, current, max, pct)
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
