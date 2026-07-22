package commands

import (
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"backend/internal/cli/dagclient"
	"backend/internal/cli/ui"
)

type watchCommand struct{}

func (watchCommand) Name() string        { return "watch" }
func (watchCommand) Description() string { return "Real-time DAG event stream monitoring (SSE)" }
func (watchCommand) Usage() string        { return "puchipix-cli watch [--with-logs] [--dag=<dagId>]" }
func (watchCommand) Aliases() []string   { return nil }

func (watchCommand) Execute(ctx CommandContext) error {
	withLogs := containsArg(ctx.Args, "--with-logs")
	dagFilter := getArg(ctx.Args, "--dag")

	sseURL := ctx.Client.GetStreamURL()
	fmt.Printf("%s\u26a1 Connecting to DAG SSE stream...%s\n", ui.Cyan, ui.Reset)
	fmt.Printf("%sURL: %s%s\n", ui.Dim, sseURL, ui.Reset)

	var logSSE *dagclient.SSEClient
	if withLogs {
		logFilter := dagclient.LogQueryFilter{}
		if dagFilter != "" {
			logFilter.DagID = dagFilter
		}
		logURL := ctx.Client.GetLogStreamURL(logFilter)
		fmt.Printf("%s\U0001f4dc Also connecting to log stream...%s\n", ui.Cyan, ui.Reset)
		fmt.Printf("%sLog URL: %s%s\n", ui.Dim, logURL, ui.Reset)
		logSSE = dagclient.NewSSEClient(logURL,
			func(event dagclient.SseEvent) {
				if event.Type == "log" {
					var entry dagclient.LogEntry
					if err := json.Unmarshal(event.Data, &entry); err == nil {
						fmt.Printf("%s\U0001f4dc %s", ui.Dim, ui.Reset)
						PrintStructuredLog(entry)
					}
				}
			},
			func(err error) {
				fmt.Fprintf(os.Stderr, "%sLog stream error: %s%s\n", ui.Red, err.Error(), ui.Reset)
			},
		)
		go logSSE.Connect()
	}

	fmt.Printf("%sPress Ctrl+C to exit%s\n\n", ui.Dim, ui.Reset)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	sse := dagclient.NewSSEClient(sseURL,
		func(event dagclient.SseEvent) { handleSseEvent(event) },
		func(err error) {
			fmt.Fprintf(os.Stderr, "%sSSE connection error: %s%s\n", ui.Red, err.Error(), ui.Reset)
			os.Exit(1)
		},
	)

	go func() {
		<-sigCh
		sse.Close()
		if logSSE != nil {
			logSSE.Close()
		}
		fmt.Printf("\n%sDisconnected%s\n", ui.Dim, ui.Reset)
		os.Exit(0)
	}()

	return sse.Connect()
}

func handleSseEvent(event dagclient.SseEvent) {
	ts := ui.FormatTime(time.Now().Format(time.RFC3339))

	var data map[string]any
	if len(event.Data) > 0 {
		_ = json.Unmarshal(event.Data, &data)
	}

	switch event.Type {
	case "initial":
		count := getInt(data, "count")
		fmt.Printf("%s%s%s %s[Initial]%s DAG count: %d\n", ui.Dim, ts, ui.Reset, ui.Bold, ui.Reset, count)

	case "stats":
		dags := getMap(data, "dags")
		sched := getMap(data, "scheduler")
		totalDags := getInt(dags, "totalDags")
		activeDags := getInt(dags, "activeDags")
		queueSize := getInt(sched, "queueSize")
		strategy := getString(sched, "strategy")
		fmt.Printf("%s%s%s %s[Stats]%s DAG: %d Active: %d Queue: %d Strategy: %s\n",
			ui.Dim, ts, ui.Reset, ui.Blue, ui.Reset, totalDags, activeDags, queueSize, strategy)

	case "dag:created":
		fmt.Printf("%s%s%s %s[DAG Created]%s %s [%s]\n",
			ui.Dim, ts, ui.Reset, ui.Green, ui.Reset,
			getString(data, "dagId"), getString(data, "taskType"))

	case "dag:completed":
		fmt.Printf("%s%s%s %s[DAG Completed]%s %s\n",
			ui.Dim, ts, ui.Reset, ui.Green, ui.Reset, getString(data, "dagId"))

	case "dag:cancelled":
		fmt.Printf("%s%s%s %s[DAG Cancelled]%s %s\n",
			ui.Dim, ts, ui.Reset, ui.Gray, ui.Reset, getString(data, "dagId"))

	case "dag:paused":
		fmt.Printf("%s%s%s %s[DAG Paused]%s %s pausedCount=%d\n",
			ui.Dim, ts, ui.Reset, ui.Magenta, ui.Reset,
			getString(data, "dagId"), getInt(data, "pausedCount"))

	case "dag:resumed":
		fmt.Printf("%s%s%s %s[DAG Resumed]%s %s resumedCount=%d\n",
			ui.Dim, ts, ui.Reset, ui.Green, ui.Reset,
			getString(data, "dagId"), getInt(data, "resumedCount"))

	case "dag:nodeProgress":
		current := getInt(data, "current")
		total := getInt(data, "total")
		pct := 0
		if total > 0 {
			pct = (current * 100) / total
		}
		speed := getString(data, "speed")
		speedStr := ""
		if speed != "" {
			speedStr = " " + speed
		}
		fmt.Printf("%s%s%s %s[Progress]%s %s/%s %s %d/%d (%d%%)%s\n",
			ui.Dim, ts, ui.Reset, ui.Yellow, ui.Reset,
			getString(data, "dagId"), getString(data, "nodeId"),
			getString(data, "phase"), current, total, pct, speedStr)

	case "dag:nodeRetrying":
		fmt.Printf("%s%s%s %s[Retrying]%s %s/%s retry=%d %s\n",
			ui.Dim, ts, ui.Reset, ui.Yellow, ui.Reset,
			getString(data, "dagId"), getString(data, "nodeId"),
			getInt(data, "retryCount"), getErrMessage(data))

	case "dag:nodeStateChanged":
		fmt.Printf("%s%s%s %s[Node State]%s %s/%s %s \u2192 %s\n",
			ui.Dim, ts, ui.Reset, ui.Magenta, ui.Reset,
			getString(data, "dagId"), getString(data, "nodeId"),
			ui.StatePill(getString(data, "from")), ui.StatePill(getString(data, "to")))

	case "dag:nodeCompleted":
		fmt.Printf("%s%s%s %s[Node Completed]%s %s/%s\n",
			ui.Dim, ts, ui.Reset, ui.Green, ui.Reset,
			getString(data, "dagId"), getString(data, "nodeId"))

	case "dag:nodeFailed":
		fmt.Printf("%s%s%s %s[Node Failed]%s %s/%s %s\n",
			ui.Dim, ts, ui.Reset, ui.Red, ui.Reset,
			getString(data, "dagId"), getString(data, "nodeId"), getErrMessage(data))

	case "dag:schedulingDecision":
		fmt.Printf("%s%s%s %s[Scheduling]%s %s/%s Strategy: %s\n",
			ui.Dim, ts, ui.Reset, ui.Cyan, ui.Reset,
			getString(data, "dagId"), getString(data, "nodeId"), getString(data, "strategy"))

	case "dag:resourceAllocated":
		fmt.Printf("%s%s%s %s[Resource Allocated]%s %s/%s\n",
			ui.Dim, ts, ui.Reset, ui.Blue, ui.Reset,
			getString(data, "dagId"), getString(data, "nodeId"))

	case "dag:resourceReleased":
		fmt.Printf("%s%s%s %s[Resource Released]%s %s/%s\n",
			ui.Dim, ts, ui.Reset, ui.Gray, ui.Reset,
			getString(data, "dagId"), getString(data, "nodeId"))

	case "worker:restarting":
		fmt.Printf("%s%s%s %s\u26a0 Worker restarting (attempt %d)...%s\n",
			ui.Dim, ts, ui.Reset, ui.Yellow, getInt(data, "restartCount"), ui.Reset)

	case "worker:ready":
		pidStr := ""
		pid := getInt(data, "pid")
		if pid > 0 {
			pidStr = fmt.Sprintf(" (PID %d)", pid)
		}
		fmt.Printf("%s%s%s %s\u2713 Worker ready%s%s\n",
			ui.Dim, ts, ui.Reset, ui.Green, pidStr, ui.Reset)

	case "task:stateReset":
		fmt.Printf("%s%s%s %s[Task State Reset]%s %d tasks reset to paused\n",
			ui.Dim, ts, ui.Reset, ui.Blue, ui.Reset, getInt(data, "count"))

	default:
		payloadStr := string(event.Data)
		if len(payloadStr) > 100 {
			payloadStr = payloadStr[:100]
		}
		fmt.Printf("%s%s%s %s[%s]%s %s\n", ui.Dim, ts, ui.Reset, ui.Dim, event.Type, ui.Reset, payloadStr)
	}
}

func getInt(m map[string]any, key string) int {
	if v, ok := m[key]; ok {
		switch n := v.(type) {
		case float64:
			return int(n)
		case int:
			return n
		}
	}
	return 0
}

func getString(m map[string]any, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func getMap(m map[string]any, key string) map[string]any {
	if v, ok := m[key]; ok {
		if mm, ok := v.(map[string]any); ok {
			return mm
		}
	}
	return map[string]any{}
}

func getErrMessage(m map[string]any) string {
	errObj := getMap(m, "error")
	return getString(errObj, "message")
}
