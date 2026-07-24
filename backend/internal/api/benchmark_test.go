package api_test

import (
	"net/http"
	"testing"

	"backend/internal/i18n"
	"backend/internal/infra"
	"backend/internal/orchestrator"
)

// BenchmarkHealthEndpoint measures the HTTP handler latency for the
// health check endpoint, which is the simplest request path.
func BenchmarkHealthEndpoint(b *testing.B) {
	infra.InitGlobalConfig("ERROR", false)
	srv := newTestServer()
	defer srv.Close()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		resp, _ := http.Get(srv.URL + "/api/health")
		resp.Body.Close()
	}
}

// BenchmarkI18nTranslation measures the T() function throughput
// for locale lookup and string interpolation.
func BenchmarkI18nTranslation(b *testing.B) {
	locales := []string{"zh-CN", "en-US", "ja-JP", "ko-KR", "de-DE"}
	params := map[string]string{"type": "gallery", "id": "42"}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		locale := locales[i%len(locales)]
		_ = i18n.T(locale, "tasks.deleted", params)
	}
}

// BenchmarkEventBusEmit measures event dispatch throughput with a
// single subscriber, reflecting the common-case LogSink listener.
func BenchmarkEventBusEmit(b *testing.B) {
	eb := infra.NewEventBus()
	count := 0
	eb.On("bench.event", func(payload any) {
		_ = count
	})

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		eb.Emit("bench.event", "payload")
	}
}

// BenchmarkLogSinkPush measures the LogSink ring buffer push throughput,
// which is on the hot path of every log call.
func BenchmarkLogSinkPush(b *testing.B) {
	sink := infra.NewLogSink(1000)
	entry := infra.StructuredLogEntry{
		Timestamp:  "2026-07-21T12:00:00.000Z",
		Level:      "INFO",
		LevelValue: 20,
		Module:     "Benchmark",
		Message:    "Benchmark log entry",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		sink.Push(entry)
	}
}

// BenchmarkStateTransition measures the state machine transition check
// throughput, which runs on every DAG node state change.
func BenchmarkStateTransition(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		orchestrator.CanTransition(
			orchestrator.NodeStateRunning,
			orchestrator.NodeStateVerifying,
		)
	}
}
