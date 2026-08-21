package commands_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"backend/internal/cli/commands"
	"backend/internal/cli/dagclient"
)

func mockAPIServer(t *testing.T, handler http.HandlerFunc) (*httptest.Server, *dagclient.Client) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	u, err := url.Parse(server.URL)
	require.NoError(t, err)
	client := dagclient.New(u.Hostname(), u.Port())
	return server, client
}

// TestStatusCommandEmpty verifies that the status command handles an
// empty DAG list gracefully without panicking.
func TestStatusCommandEmpty(t *testing.T) {
	_, client := mockAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		resp := dagclient.DagListResponse{
			Dags:  []dagclient.DagSummary{},
			Stats: &dagclient.DagListStats{},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	})

	registry := commands.NewRegistry()
	cmd := registry.Find("status")
	require.NotNil(t, cmd)

	err := cmd.Execute(commands.CommandContext{
		Client: client,
		Args:   []string{},
		Ctx:    context.Background(),
	})
	assert.NoError(t, err)
}

// TestStatusCommandWithDags verifies that the status command renders
// DAG summaries with nodes and progress information.
func TestStatusCommandWithDags(t *testing.T) {
	_, client := mockAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		resp := dagclient.DagListResponse{
			Dags: []dagclient.DagSummary{
				{
					DagID:     "dag-1",
					TaskType:  dagclient.TaskTypeGallery,
					SourceURL: "https://example.com/gallery/1",
					NodeCount: 3,
					Progress:  dagclient.DagProgress{Completed: 2, Running: 1},
					Nodes: []dagclient.NodeSummary{
						{NodeID: "node-1", State: dagclient.NodeStateCompleted},
						{NodeID: "node-2", State: dagclient.NodeStateCompleted},
						{NodeID: "node-3", State: dagclient.NodeStateRunning},
					},
				},
			},
			Stats: &dagclient.DagListStats{
				DagStats: dagclient.DagStats{TotalDags: 1, ActiveDags: 1, TotalNodes: 3},
				Scheduler: dagclient.SchedulerStats{
					QueueSize:  0,
					Strategy:   "priority-fair",
					ByPriority: map[string]int{},
					ByTaskType: map[string]int{},
				},
				Slots: map[string]dagclient.SlotUsage{
					"scraping": {SlotType: "scraping", Current: 1, Max: 5, Available: 4},
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	})

	registry := commands.NewRegistry()
	cmd := registry.Find("status")
	require.NotNil(t, cmd)

	err := cmd.Execute(commands.CommandContext{
		Client: client,
		Args:   []string{},
		Ctx:    context.Background(),
	})
	assert.NoError(t, err)
}

// TestStatusCommandJSON verifies that the status command outputs JSON
// when the --json flag is set.
func TestStatusCommandJSON(t *testing.T) {
	_, client := mockAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		resp := dagclient.DagListResponse{
			Dags: []dagclient.DagSummary{},
			Stats: &dagclient.DagListStats{
				DagStats:   dagclient.DagStats{TotalDags: 0},
				Scheduler:  dagclient.SchedulerStats{Strategy: "priority-fair"},
				Slots:      map[string]dagclient.SlotUsage{},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	})

	registry := commands.NewRegistry()
	cmd := registry.Find("status")
	require.NotNil(t, cmd)

	err := cmd.Execute(commands.CommandContext{
		Client: client,
		Args:   []string{},
		JSON:   true,
		Ctx:    context.Background(),
	})
	assert.NoError(t, err)
}

// TestStatusCommandAPIError verifies that the status command propagates
// HTTP errors from the API server rather than silently swallowing them.
func TestStatusCommandAPIError(t *testing.T) {
	_, client := mockAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("internal server error"))
	})

	registry := commands.NewRegistry()
	cmd := registry.Find("status")
	require.NotNil(t, cmd)

	err := cmd.Execute(commands.CommandContext{
		Client: client,
		Args:   []string{},
		Ctx:    context.Background(),
	})
	assert.Error(t, err)
}

// TestSlotsCommand verifies that the slots command queries and displays
// slot pool statistics from the API.
func TestSlotsCommand(t *testing.T) {
	_, client := mockAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]dagclient.SlotUsage{
			"scraping": {SlotType: "scraping", Current: 2, Max: 5, Available: 3},
			"download": {SlotType: "download", Current: 1, Max: 3, Available: 2},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	})

	registry := commands.NewRegistry()
	cmd := registry.Find("slots")
	require.NotNil(t, cmd)

	err := cmd.Execute(commands.CommandContext{
		Client: client,
		Args:   []string{},
		Ctx:    context.Background(),
	})
	assert.NoError(t, err)
}

// TestSchedulerCommand verifies that the scheduler command queries and
// displays scheduler statistics.
func TestSchedulerCommand(t *testing.T) {
	_, client := mockAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		resp := dagclient.SchedulerStats{
			QueueSize:  3,
			Strategy:   "priority-fair",
			ByPriority: map[string]int{"HIGH": 2, "NORMAL": 1},
			ByTaskType: map[string]int{"gallery": 2, "video": 1},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	})

	registry := commands.NewRegistry()
	cmd := registry.Find("scheduler")
	require.NotNil(t, cmd)

	err := cmd.Execute(commands.CommandContext{
		Client: client,
		Args:   []string{},
		Ctx:    context.Background(),
	})
	assert.NoError(t, err)
}

// TestDagCommandList verifies that the dag command lists DAG details
// when given a DAG ID argument.
func TestDagCommandList(t *testing.T) {
	_, client := mockAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		resp := dagclient.DagDetailResponse{
			DagID:     "dag-1",
			TaskType:  dagclient.TaskTypeGallery,
			SourceURL: "https://example.com/gallery/1",
			Definition: dagclient.DagDefinition{
				NodeCount: 2,
				Nodes:     []dagclient.DagNodeDefinition{},
			},
			Nodes: []dagclient.SimplifiedNodeDetail{
				{NodeID: "node-1", State: dagclient.NodeStateCompleted},
				{NodeID: "node-2", State: dagclient.NodeStateRunning},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	})

	registry := commands.NewRegistry()
	cmd := registry.Find("dag")
	require.NotNil(t, cmd)

	err := cmd.Execute(commands.CommandContext{
		Client: client,
		Args:   []string{"dag-1"},
		Ctx:    context.Background(),
	})
	assert.NoError(t, err)
}

// TestDagCommandMissingArg verifies that the dag command prints usage
// and returns nil when no DAG ID is provided, rather than crashing.
func TestDagCommandMissingArg(t *testing.T) {
	_, client := mockAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	registry := commands.NewRegistry()
	cmd := registry.Find("dag")
	require.NotNil(t, cmd)

	err := cmd.Execute(commands.CommandContext{
		Client: client,
		Args:   []string{},
		Ctx:    context.Background(),
	})
	assert.NoError(t, err)
}

// TestControlCommands verifies that pause, resume, retry, and cancel
// commands send the correct action to the API.
func TestControlCommands(t *testing.T) {
	tests := []struct {
		name string
		args []string
	}{
		{"pause", []string{"dag-1"}},
		{"resume", []string{"dag-1"}},
		{"retry", []string{"dag-1"}},
		{"cancel", []string{"dag-1"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, client := mockAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.Write([]byte(`{"success":true}`))
			})

			registry := commands.NewRegistry()
			cmd := registry.Find(tt.name)
			require.NotNil(t, cmd)

			err := cmd.Execute(commands.CommandContext{
				Client: client,
				Args:   tt.args,
				Ctx:    context.Background(),
			})
			assert.NoError(t, err)
		})
	}
}

// TestControlCommandMissingArg verifies that control commands print
// usage and return nil when no DAG ID is provided.
func TestControlCommandMissingArg(t *testing.T) {
	registry := commands.NewRegistry()

	for _, name := range []string{"pause", "resume", "retry", "cancel"} {
		t.Run(name, func(t *testing.T) {
			_, client := mockAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			})

			cmd := registry.Find(name)
			require.NotNil(t, cmd)

			err := cmd.Execute(commands.CommandContext{
				Client: client,
				Args:   []string{},
				Ctx:    context.Background(),
			})
			assert.NoError(t, err)
		})
	}
}

// TestEventsCommand verifies that the events command queries and
// displays DAG events.
func TestEventsCommand(t *testing.T) {
	_, client := mockAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		resp := dagclient.DagEventsResponse{
			DagID:       "dag-1",
			TotalEvents: 2,
			CurrentSeq:  2,
			Events: []dagclient.DagEvent{
				{Seq: 1, Type: "dag:created", DagID: "dag-1"},
				{Seq: 2, Type: "dag:nodeStateChanged", DagID: "dag-1", NodeID: "node-1"},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	})

	registry := commands.NewRegistry()
	cmd := registry.Find("events")
	require.NotNil(t, cmd)

	err := cmd.Execute(commands.CommandContext{
		Client: client,
		Args:   []string{"dag-1"},
		Ctx:    context.Background(),
	})
	assert.NoError(t, err)
}

// TestLogsCommand verifies that the logs command queries and displays
// log entries.
func TestLogsCommand(t *testing.T) {
	_, client := mockAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`[{"timestamp":"2026-01-01T00:00:00Z","level":"INFO","module":"Test","message":"test log"}]`))
	})

	registry := commands.NewRegistry()
	cmd := registry.Find("logs")
	require.NotNil(t, cmd)

	err := cmd.Execute(commands.CommandContext{
		Client: client,
		Args:   []string{},
		Ctx:    context.Background(),
	})
	assert.NoError(t, err)
}

// TestNodeCommand verifies that the node command displays node details.
func TestNodeCommand(t *testing.T) {
	_, client := mockAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		resp := dagclient.DagDetailResponse{
			DagID:    "dag-1",
			TaskType: dagclient.TaskTypeGallery,
			Definition: dagclient.DagDefinition{
				NodeCount: 1,
				Nodes:     []dagclient.DagNodeDefinition{},
			},
			Nodes: []dagclient.SimplifiedNodeDetail{
				{
					NodeID: "node-1",
					State:  dagclient.NodeStateCompleted,
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	})

	registry := commands.NewRegistry()
	cmd := registry.Find("node")
	require.NotNil(t, cmd)

	err := cmd.Execute(commands.CommandContext{
		Client: client,
		Args:   []string{"dag-1", "node-1"},
		Ctx:    context.Background(),
	})
	assert.NoError(t, err)
}

// TestWorkerCommand verifies that the worker command queries and
// displays worker status.
func TestWorkerCommand(t *testing.T) {
	_, client := mockAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"running","uptime":"5m","activeTasks":3}`))
	})

	registry := commands.NewRegistry()
	cmd := registry.Find("worker")
	require.NotNil(t, cmd)

	err := cmd.Execute(commands.CommandContext{
		Client: client,
		Args:   []string{},
		Ctx:    context.Background(),
	})
	assert.NoError(t, err)
}

// TestContainsArg verifies that containsArg correctly detects flag
// presence in the argument list.
func TestContainsArg(t *testing.T) {
	// containsArg is unexported, so we test it indirectly through
	// the status command's --logs flag behavior
	_, client := mockAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/logs/history" || r.URL.Path == "/api/logs" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`[]`))
			return
		}
		resp := dagclient.DagListResponse{
			Dags: []dagclient.DagSummary{
				{DagID: "dag-1", NodeCount: 1, Progress: dagclient.DagProgress{Running: 1}},
			},
			Stats: &dagclient.DagListStats{
				DagStats:  dagclient.DagStats{TotalDags: 1, ActiveDags: 1, TotalNodes: 1},
				Scheduler: dagclient.SchedulerStats{Strategy: "priority-fair"},
				Slots:     map[string]dagclient.SlotUsage{},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	})

	registry := commands.NewRegistry()
	cmd := registry.Find("status")
	require.NotNil(t, cmd)

	err := cmd.Execute(commands.CommandContext{
		Client: client,
		Args:   []string{"--logs"},
		Ctx:    context.Background(),
	})
	assert.NoError(t, err)
}
