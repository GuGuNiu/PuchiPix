package ui

import "fmt"

const (
	Reset     = "\033[0m"
	Bold      = "\033[1m"
	Dim       = "\033[2m"
	Italic    = "\033[3m"
	Underline = "\033[4m"
	Gray      = "\033[90m"
	Red       = "\033[31m"
	Green     = "\033[32m"
	Yellow    = "\033[33m"
	Blue      = "\033[34m"
	Magenta   = "\033[35m"
	Cyan      = "\033[36m"
	White     = "\033[37m"
	BgRed     = "\033[41m"
	BgGreen   = "\033[42m"
	BgYellow  = "\033[43m"
	BgBlue    = "\033[44m"
)

// StateStyle pairs an ANSI color code with the label of a node state. Labels
// must stay identical to the frontend STATE_STYLE map so both surfaces render
// the same state the same way.
type StateStyle struct {
	Color string
	Label string
}

var stateStyles = map[string]StateStyle{
	"pending":       {Gray, "\u23f3 PENDING"},
	"ready":         {Gray, "\u26ab READY"},
	"queued":        {Yellow, "\U0001f7e1 QUEUED"},
	"allocated":     {Blue, "\U0001f535 ALLOCATED"},
	"running":       {Cyan, "\u26a1 RUNNING"},
	"paused":        {Yellow, "\u23f8  PAUSED"},
	"verifying":     {Magenta, "\U0001f50d VERIFYING"},
	"resume_verify": {Magenta, "\U0001f50d RESUME_VERIFY"},
	"completed":     {Green, "\u2705 COMPLETED"},
	"failed":        {Red, "\u274c FAILED"},
	"cancelled":     {Gray, "\U0001f6ab CANCELLED"},
	"timeout":       {Red, "\u23f0 TIMEOUT"},
	"needs_retry":   {Yellow, "\u21bb NEEDS_RETRY"},
}

func StateLabel(state string) string {
	style, ok := stateStyles[state]
	if !ok {
		return state
	}
	return style.Color + style.Label + Reset
}

// StatePill renders the state as a fixed-width pill, unknown states are
// padded to the same width so table columns stay aligned.
func StatePill(state string) string {
	style, ok := stateStyles[state]
	if !ok {
		return padRight(state, 10)
	}
	return style.Color + padRight(fmt.Sprintf("%s", state), 10) + Reset
}

type LogLevelStyle struct {
	Color string
	Label string
}

var logLevelStyles = map[string]LogLevelStyle{
	"debug": {Dim, "DEBUG"},
	"info":  {Green, " INFO"},
	"warn":  {Yellow, " WARN"},
	"error": {Red, "ERROR"},
}

func LogLevelLabel(level string) string {
	style, ok := logLevelStyles[toLowerCase(level)]
	if !ok {
		return padRight(toUpperCase(level), 5)
	}
	return style.Color + style.Label + Reset
}

func padRight(s string, width int) string {
	if len(s) >= width {
		return s
	}
	return s + spaces(width-len(s))
}

func spaces(n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = ' '
	}
	return string(b)
}

func toLowerCase(s string) string {
	b := []byte(s)
	for i := range b {
		if b[i] >= 'A' && b[i] <= 'Z' {
			b[i] += 32
		}
	}
	return string(b)
}

func toUpperCase(s string) string {
	b := []byte(s)
	for i := range b {
		if b[i] >= 'a' && b[i] <= 'z' {
			b[i] -= 32
		}
	}
	return string(b)
}
