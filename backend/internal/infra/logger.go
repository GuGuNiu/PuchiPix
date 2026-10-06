package infra

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

type LogLevel int

const (
	LevelDebug LogLevel = 10
	LevelInfo  LogLevel = 20
	LevelWarn  LogLevel = 30
	LevelError LogLevel = 40
)

// LogContext carries trace identifiers that flow through every log call.
// JSON tags are camelCase so SSE log entries expose dagId/nodeId/traceId
// at the top level.
type LogContext struct {
	TraceID  string         `json:"traceId,omitempty"`
	DagID    string         `json:"dagId,omitempty"`
	NodeID   string         `json:"nodeId,omitempty"`
	TaskType string         `json:"taskType,omitempty"`
	Phase    string         `json:"phase,omitempty"`
	Extra    map[string]any `json:"extra,omitempty"`
}

// Merge returns a new LogContext with fields from other overriding self.
func (c LogContext) Merge(other LogContext) LogContext {
	out := c
	if other.TraceID != "" {
		out.TraceID = other.TraceID
	}
	if other.DagID != "" {
		out.DagID = other.DagID
	}
	if other.NodeID != "" {
		out.NodeID = other.NodeID
	}
	if other.TaskType != "" {
		out.TaskType = other.TaskType
	}
	if other.Phase != "" {
		out.Phase = other.Phase
	}
	if len(other.Extra) > 0 {
		if out.Extra == nil {
			out.Extra = make(map[string]any, len(other.Extra))
		}
		for k, v := range other.Extra {
			out.Extra[k] = v
		}
	}
	return out
}

func (c LogContext) IsEmpty() bool {
	return c.TraceID == "" && c.DagID == "" && c.NodeID == "" &&
		c.TaskType == "" && c.Phase == "" && len(c.Extra) == 0
}

// StructuredLogEntry is the wire format for log entries consumed by the API and CLI.
type StructuredLogEntry struct {
	Timestamp  string     `json:"timestamp"`
	Level      string     `json:"level"`
	LevelValue LogLevel   `json:"levelValue"`
	Module     string     `json:"module"`
	Message    string     `json:"message"`
	Context    LogContext `json:"context"`
	Data       any        `json:"data,omitempty"`
}

// Logger emits structured log entries to both the console and the global LogSink.
type Logger struct {
	module       string
	boundContext LogContext
	sink         *LogSink
	minLevel     LogLevel
	isDev        bool
}

// traceContextKey propagates trace identifiers across goroutine boundaries.
type traceContextKey struct{}

// WithTraceContext stores a LogContext in a context.Context so downstream
// code can retrieve it via TraceFromContext.
func WithTraceContext(ctx context.Context, lc LogContext) context.Context {
	return context.WithValue(ctx, traceContextKey{}, lc)
}

// TraceFromContext extracts the LogContext stored by WithTraceContext.
func TraceFromContext(ctx context.Context) (LogContext, bool) {
	lc, ok := ctx.Value(traceContextKey{}).(LogContext)
	return lc, ok
}

const (
	ansiReset   = "\x1b[0m"
	ansiDim     = "\x1b[2m"
	ansiGray    = "\x1b[90m"
	ansiCyan    = "\x1b[36m"
	ansiGreen   = "\x1b[32m"
	ansiYellow  = "\x1b[33m"
	ansiRed     = "\x1b[31m"
	ansiMagenta = "\x1b[35m"
	ansiBlue    = "\x1b[34m"
)

var levelLabels = map[LogLevel]string{
	LevelDebug: "DEBUG",
	LevelInfo:  " INFO",
	LevelWarn:  " WARN",
	LevelError: "ERROR",
}

var levelColors = map[LogLevel]string{
	LevelDebug: ansiDim,
	LevelInfo:  ansiGreen,
	LevelWarn:  ansiYellow,
	LevelError: ansiRed,
}

func parseLogLevel(s string) LogLevel {
	upper := strings.ToUpper(s)
	switch upper {
	case "DEBUG":
		return LevelDebug
	case "INFO":
		return LevelInfo
	case "WARN", "WARNING":
		return LevelWarn
	case "ERROR":
		return LevelError
	}
	return LevelInfo
}

func generateTraceID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func formatTimestamp(t time.Time) string {
	return t.Format("2006-01-02 15:04:05.000")
}

func formatDev(entry StructuredLogEntry) string {
	ts := formatTimestamp(time.Now())
	lv := entry.LevelValue
	levelStr := fmt.Sprintf("%s%s%s", levelColors[lv], levelLabels[lv], ansiReset)
	moduleStr := fmt.Sprintf("%s[%s]%s", ansiCyan, entry.Module, ansiReset)

	var ctxParts []string
	if entry.Context.TraceID != "" {
		ctxParts = append(ctxParts, fmt.Sprintf("%strace=%s%s", ansiMagenta, entry.Context.TraceID, ansiReset))
	}
	if entry.Context.DagID != "" {
		ctxParts = append(ctxParts, fmt.Sprintf("%sdag=%s%s", ansiBlue, entry.Context.DagID, ansiReset))
	}
	if entry.Context.NodeID != "" {
		ctxParts = append(ctxParts, fmt.Sprintf("%snode=%s%s", ansiBlue, entry.Context.NodeID, ansiReset))
	}
	if entry.Context.TaskType != "" {
		ctxParts = append(ctxParts, fmt.Sprintf("%stype=%s%s", ansiGray, entry.Context.TaskType, ansiReset))
	}
	if entry.Context.Phase != "" {
		ctxParts = append(ctxParts, fmt.Sprintf("%sphase=%s%s", ansiGray, entry.Context.Phase, ansiReset))
	}
	for k, v := range entry.Context.Extra {
		if v == nil {
			continue
		}
		val := fmt.Sprintf("%v", v)
		if b, err := json.Marshal(v); err == nil {
			val = string(b)
		}
		ctxParts = append(ctxParts, fmt.Sprintf("%s%s=%s%s", ansiGray, k, val, ansiReset))
	}

	ctxStr := ""
	if len(ctxParts) > 0 {
		ctxStr = " " + strings.Join(ctxParts, " ")
	}

	dataStr := ""
	if entry.Data != nil {
		if err, ok := entry.Data.(error); ok {
			dataStr = fmt.Sprintf("\n  %s%s%s", ansiRed, err.Error(), ansiReset)
		} else if b, err := json.MarshalIndent(entry.Data, "  ", "  "); err == nil {
			dataStr = fmt.Sprintf("\n  %s%s%s", ansiGray, string(b), ansiReset)
		} else {
			dataStr = fmt.Sprintf(" %s%v%s", ansiGray, entry.Data, ansiReset)
		}
	}

	return fmt.Sprintf("%s%s%s %s %s%s%s%s",
		ansiDim, ts, ansiReset,
		levelStr, moduleStr, entry.Message, ctxStr, dataStr)
}

func formatJSON(entry StructuredLogEntry) string {
	record := map[string]any{
		"timestamp": entry.Timestamp,
		"level":     entry.Level,
		"module":    entry.Module,
		"message":   entry.Message,
	}
	if entry.Context.TraceID != "" {
		record["traceId"] = entry.Context.TraceID
	}
	if entry.Context.DagID != "" {
		record["dagId"] = entry.Context.DagID
	}
	if entry.Context.NodeID != "" {
		record["nodeId"] = entry.Context.NodeID
	}
	if entry.Context.TaskType != "" {
		record["taskType"] = entry.Context.TaskType
	}
	if entry.Context.Phase != "" {
		record["phase"] = entry.Context.Phase
	}
	for k, v := range entry.Context.Extra {
		if v != nil {
			record[k] = v
		}
	}
	if entry.Data != nil {
		if err, ok := entry.Data.(error); ok {
			record["error"] = map[string]string{
				"name":    fmt.Sprintf("%T", err),
				"message": err.Error(),
			}
		} else {
			record["data"] = entry.Data
		}
	}
	b, _ := json.Marshal(record)
	return string(b)
}

// normalizeLogArgs converts variadic key-value pairs into a map. String
// values at even positions pair with the following arg; anything that does
// not fit becomes arg<N> so no argument is silently dropped.
func normalizeLogArgs(data []any) map[string]any {
	out := make(map[string]any, len(data))
	for i := 0; i < len(data); {
		if key, ok := data[i].(string); ok && i+1 < len(data) {
			out[key] = logArgValue(data[i+1])
			i += 2
		} else {
			out[fmt.Sprintf("arg%d", i)] = logArgValue(data[i])
			i++
		}
	}
	return out
}

// logArgValue stringifies errors so they serialize as messages instead of
// empty objects.
func logArgValue(v any) any {
	if err, ok := v.(error); ok {
		return err.Error()
	}
	return v
}

func (l *Logger) log(level LogLevel, message string, data ...any) {
	if level < l.minLevel {
		return
	}

	var dataVal any
	switch len(data) {
	case 0:
	case 1:
		dataVal = data[0]
	default:
		// Multiple variadic args are key-value pairs ("key", value, ...).
		// Normalizing into a map keeps every structured field; args that do
		// not fit the pair pattern fall back to argN keys, and error values
		// are stringified so they survive JSON marshaling.
		dataVal = normalizeLogArgs(data)
	}

	entry := StructuredLogEntry{
		Timestamp:  time.Now().Format(time.RFC3339Nano),
		Level:      strings.TrimSpace(levelLabels[level]),
		LevelValue: level,
		Module:     l.module,
		Message:    message,
		Context:    l.boundContext,
		Data:       dataVal,
	}

	var output string
	if l.isDev {
		output = formatDev(entry)
	} else {
		output = formatJSON(entry)
	}

	switch {
	case level >= LevelError:
		fmt.Fprintln(os.Stderr, output)
	case level >= LevelWarn:
		fmt.Fprintln(os.Stderr, output)
	default:
		fmt.Fprintln(os.Stdout, output)
	}

	if l.sink != nil {
		l.sink.Push(entry)
	}
}

func (l *Logger) Debug(message string, data ...any) { l.log(LevelDebug, message, data...) }
func (l *Logger) Info(message string, data ...any)  { l.log(LevelInfo, message, data...) }
func (l *Logger) Warn(message string, data ...any)  { l.log(LevelWarn, message, data...) }
func (l *Logger) Error(message string, data ...any) { l.log(LevelError, message, data...) }

// Child returns a new Logger whose bound context is this logger's context
// merged with ctx, so trace identifiers do not need threading through
// every call site.
func (l *Logger) Child(ctx LogContext) *Logger {
	return &Logger{
		module:       l.module,
		boundContext: l.boundContext.Merge(ctx),
		sink:         l.sink,
		minLevel:     l.minLevel,
		isDev:        l.isDev,
	}
}

func (l *Logger) RunWith(ctx context.Context, traceCtx LogContext, fn func(context.Context) error) error {
	merged := l.boundContext.Merge(traceCtx)
	if merged.TraceID == "" {
		if existing, ok := TraceFromContext(ctx); ok && existing.TraceID != "" {
			merged.TraceID = existing.TraceID
		} else {
			merged.TraceID = generateTraceID()
		}
	}
	return fn(WithTraceContext(ctx, merged))
}

// loggerRegistry caches Logger instances by module name.
type loggerRegistry struct {
	mu      sync.Mutex
	loggers map[string]*Logger
}

func (r *loggerRegistry) get(module string, sink *LogSink, minLevel LogLevel, isDev bool) *Logger {
	r.mu.Lock()
	defer r.mu.Unlock()
	if existing, ok := r.loggers[module]; ok {
		return existing
	}
	l := &Logger{
		module:   module,
		sink:     sink,
		minLevel: minLevel,
		isDev:    isDev,
	}
	r.loggers[module] = l
	return l
}

var (
	globalSink     *LogSink
	globalSinkOnce sync.Once

	registry     = &loggerRegistry{loggers: make(map[string]*Logger)}
	globalConfig struct {
		mu       sync.RWMutex
		minLevel LogLevel
		isDev    bool
	}
)

// InitGlobalSink creates the singleton LogSink. Call once at startup, before
// the first NewLogger; later calls are no-ops.
func InitGlobalSink(capacity int) {
	globalSinkOnce.Do(func() {
		globalSink = NewLogSink(capacity)
	})
}

func InitGlobalConfig(logLevel string, isDev bool) {
	globalConfig.mu.Lock()
	defer globalConfig.mu.Unlock()
	globalConfig.minLevel = parseLogLevel(logLevel)
	globalConfig.isDev = isDev
}

func getGlobalConfig() (LogLevel, bool) {
	globalConfig.mu.RLock()
	defer globalConfig.mu.RUnlock()
	return globalConfig.minLevel, globalConfig.isDev
}

// NewLogger returns a cached Logger for the given module, bound to the
// global LogSink and the global log level / dev mode.
func NewLogger(module string) *Logger {
	if globalSink == nil {
		InitGlobalSink(1000)
	}
	minLevel, isDev := getGlobalConfig()
	if minLevel == 0 {
		minLevel = LevelInfo
	}
	return registry.get(module, globalSink, minLevel, isDev)
}

func GetGlobalSink() *LogSink {
	if globalSink == nil {
		InitGlobalSink(1000)
	}
	return globalSink
}
