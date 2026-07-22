package dag

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestNewManager verifies that a new manager starts with empty state,
// ensuring no stale data leaks between test runs.
func TestNewManager(t *testing.T) {
	m := NewManager()
	stats := m.GetStats()
	assert.Equal(t, 0, stats.TaskCount)
	assert.Equal(t, 0, stats.DependencyCount)
}

// TestAddTaskSimple verifies that adding a task without dependencies
// places it directly into the ready set.
func TestAddTaskSimple(t *testing.T) {
	m := NewManager()
	m.AddTask(DagCapableTask{ID: "A", Priority: 1})

	assert.True(t, m.AreDependenciesMet("A"))
	stats := m.GetStats()
	assert.Equal(t, 1, stats.TaskCount)
	assert.Equal(t, 1, stats.ReadyCount)
}

// TestAddTaskWithDependency verifies that a task with an unmet dependency
// is not placed in the ready set until the dependency completes.
func TestAddTaskWithDependency(t *testing.T) {
	m := NewManager()
	m.AddTask(DagCapableTask{ID: "A", Priority: 1})
	m.AddTask(DagCapableTask{ID: "B", DependsOn: []string{"A"}, Priority: 1})

	assert.True(t, m.AreDependenciesMet("A"))
	assert.False(t, m.AreDependenciesMet("B"))

	stats := m.GetStats()
	assert.Equal(t, 2, stats.TaskCount)
	assert.Equal(t, 1, stats.DependencyCount)
	assert.Equal(t, 1, stats.ReadyCount)
}

// TestAddDependencyCreatesPlaceholder verifies that adding a dependency
// on a non-existent task creates a placeholder so the graph stays consistent.
func TestAddDependencyCreatesPlaceholder(t *testing.T) {
	m := NewManager()
	m.AddTask(DagCapableTask{ID: "A", Priority: 1})
	m.AddDependency("A", "B")

	stats := m.GetStats()
	assert.Equal(t, 2, stats.TaskCount, "placeholder B should be created")
	assert.False(t, m.AreDependenciesMet("A"), "A should wait on placeholder B")
}

// TestAddDependencySelfLoop verifies that a self-dependency panics,
// preventing a trivially unsolvable cycle from corrupting the graph.
func TestAddDependencySelfLoop(t *testing.T) {
	m := NewManager()
	m.AddTask(DagCapableTask{ID: "A"})

	assert.Panics(t, func() {
		m.AddDependency("A", "A")
	})
}

// TestAddDependencySelfLoopViaAddTask verifies the same self-loop guard
// fires when a task declares a dependency on itself in its DependsOn list.
func TestAddDependencySelfLoopViaAddTask(t *testing.T) {
	m := NewManager()

	assert.Panics(t, func() {
		m.AddTask(DagCapableTask{ID: "A", DependsOn: []string{"A"}})
	})
}

// TestMarkCompletedUnblocks verifies that completing a task moves its
// dependents into the ready set.
func TestMarkCompletedUnblocks(t *testing.T) {
	m := NewManager()
	m.AddTask(DagCapableTask{ID: "A", Priority: 1})
	m.AddTask(DagCapableTask{ID: "B", DependsOn: []string{"A"}, Priority: 1})

	assert.False(t, m.AreDependenciesMet("B"))
	unblocked := m.MarkCompleted("A")
	assert.Equal(t, []string{"B"}, unblocked)
	assert.True(t, m.AreDependenciesMet("B"))
	assert.True(t, m.IsCompleted("A"))
}

// TestMarkCompletedNoDependents verifies that completing a task with no
// dependents returns an empty slice (not nil-crash).
func TestMarkCompletedNoDependents(t *testing.T) {
	m := NewManager()
	m.AddTask(DagCapableTask{ID: "A", Priority: 1})

	unblocked := m.MarkCompleted("A")
	assert.Empty(t, unblocked)
}

// TestMarkFailedCascades verifies that failing a task cascades the failure
// to all transitive dependents.
func TestMarkFailedCascades(t *testing.T) {
	m := NewManager()
	m.AddTask(DagCapableTask{ID: "A", Priority: 1})
	m.AddTask(DagCapableTask{ID: "B", DependsOn: []string{"A"}, Priority: 1})
	m.AddTask(DagCapableTask{ID: "C", DependsOn: []string{"B"}, Priority: 1})

	cascaded := m.MarkFailed("A")
	assert.Len(t, cascaded, 2)
	assert.True(t, m.IsFailedOrCanceled("B"))
	assert.True(t, m.IsFailedOrCanceled("C"))
}

// TestMarkFailedNoDependents verifies that failing a leaf task does not
// cascade to anything.
func TestMarkFailedNoDependents(t *testing.T) {
	m := NewManager()
	m.AddTask(DagCapableTask{ID: "A", Priority: 1})

	cascaded := m.MarkFailed("A")
	assert.Empty(t, cascaded)
	assert.True(t, m.IsFailedOrCanceled("A"))
}

// TestMarkFailedDiamondDependency verifies that cascade failure respects
// diamond dependencies: if one branch fails, the other branch's tasks
// are only cascaded if they truly depend on the failed task.
func TestMarkFailedDiamondDependency(t *testing.T) {
	m := NewManager()
	m.AddTask(DagCapableTask{ID: "A", Priority: 1})
	m.AddTask(DagCapableTask{ID: "B1", DependsOn: []string{"A"}, Priority: 1})
	m.AddTask(DagCapableTask{ID: "B2", Priority: 1})
	m.AddTask(DagCapableTask{ID: "C", DependsOn: []string{"B1", "B2"}, Priority: 1})

	cascaded := m.MarkFailed("B1")
	assert.Contains(t, cascaded, "C")
	assert.False(t, m.IsFailedOrCanceled("B2"), "B2 has no dependency on B1")
}

// TestGetNextExecutableByPriority verifies that among ready tasks,
// the highest-priority one is selected.
func TestGetNextExecutableByPriority(t *testing.T) {
	m := NewManager()
	m.AddTask(DagCapableTask{ID: "A", Priority: 1})
	m.AddTask(DagCapableTask{ID: "B", Priority: 5})
	m.AddTask(DagCapableTask{ID: "C", Priority: 3})

	candidates := []*DagCapableTask{
		{ID: "A", Priority: 1},
		{ID: "B", Priority: 5},
		{ID: "C", Priority: 3},
	}
	next := m.GetNextExecutable(candidates)
	require.NotNil(t, next)
	assert.Equal(t, "B", next.ID)
}

// TestGetNextExecutableRespectsDependencies verifies that a candidate
// with unmet dependencies is not selected even if it has high priority.
func TestGetNextExecutableRespectsDependencies(t *testing.T) {
	m := NewManager()
	m.AddTask(DagCapableTask{ID: "A", Priority: 1})
	m.AddTask(DagCapableTask{ID: "B", DependsOn: []string{"A"}, Priority: 10})

	candidates := []*DagCapableTask{
		{ID: "A", Priority: 1},
		{ID: "B", Priority: 10},
	}
	next := m.GetNextExecutable(candidates)
	require.NotNil(t, next)
	assert.Equal(t, "A", next.ID, "B should be blocked by dependency on A")
}

// TestGetNextExecutableEmpty verifies that an empty candidate list
// returns nil without panicking.
func TestGetNextExecutableEmpty(t *testing.T) {
	m := NewManager()
	next := m.GetNextExecutable(nil)
	assert.Nil(t, next)
}

// TestGetNextExecutableNoneReady verifies that nil is returned when
// no candidate has its dependencies met.
func TestGetNextExecutableNoneReady(t *testing.T) {
	m := NewManager()
	m.AddTask(DagCapableTask{ID: "A", Priority: 1})
	m.AddTask(DagCapableTask{ID: "B", DependsOn: []string{"A"}, Priority: 1})

	candidates := []*DagCapableTask{
		{ID: "B", Priority: 1},
	}
	next := m.GetNextExecutable(candidates)
	assert.Nil(t, next, "B is not ready because A has not completed")
}

// TestGetNextExecutableNoDeps verifies that when the graph has no
// dependencies, any candidate is eligible and the highest priority wins.
func TestGetNextExecutableNoDeps(t *testing.T) {
	m := NewManager()
	m.AddTask(DagCapableTask{ID: "X", Priority: 2})

	candidates := []*DagCapableTask{
		{ID: "A", Priority: 1},
		{ID: "B", Priority: 3},
	}
	next := m.GetNextExecutable(candidates)
	require.NotNil(t, next)
	assert.Equal(t, "B", next.ID)
}

// TestDetectCyclesNoCycle verifies that an acyclic graph returns no error.
func TestDetectCyclesNoCycle(t *testing.T) {
	m := NewManager()
	m.AddTask(DagCapableTask{ID: "A"})
	m.AddTask(DagCapableTask{ID: "B", DependsOn: []string{"A"}})
	m.AddTask(DagCapableTask{ID: "C", DependsOn: []string{"B"}})

	err := m.DetectCycles()
	assert.NoError(t, err)
}

// TestDetectCyclesSimple verifies a simple A��B��A cycle is detected.
func TestDetectCyclesSimple(t *testing.T) {
	m := NewManager()
	m.AddTask(DagCapableTask{ID: "A"})
	m.AddTask(DagCapableTask{ID: "B", DependsOn: []string{"A"}})
	m.AddDependency("A", "B")

	err := m.DetectCycles()
	require.Error(t, err)
	cycleErr, ok := err.(*CycleError)
	require.True(t, ok, "error should be *CycleError")
	assert.NotEmpty(t, cycleErr.CyclePath)
}

// TestDetectCyclesComplex verifies a longer cycle A��B��C��D��A is detected.
func TestDetectCyclesComplex(t *testing.T) {
	m := NewManager()
	m.AddTask(DagCapableTask{ID: "A"})
	m.AddTask(DagCapableTask{ID: "B", DependsOn: []string{"A"}})
	m.AddTask(DagCapableTask{ID: "C", DependsOn: []string{"B"}})
	m.AddTask(DagCapableTask{ID: "D", DependsOn: []string{"C"}})
	m.AddDependency("A", "D")

	err := m.DetectCycles()
	require.Error(t, err)
}

// TestCycleErrorFormat verifies the error message format is human-readable.
func TestCycleErrorFormat(t *testing.T) {
	e := &CycleError{CyclePath: []string{"A", "B", "C", "A"}}
	msg := e.Error()
	assert.Contains(t, msg, "cycle detected")
	assert.Contains(t, msg, "A -> B -> C -> A")
}

// TestTopologicalSort verifies correct dependency ordering.
func TestTopologicalSort(t *testing.T) {
	m := NewManager()
	m.AddTask(DagCapableTask{ID: "D", DependsOn: []string{"C"}})
	m.AddTask(DagCapableTask{ID: "C", DependsOn: []string{"B"}})
	m.AddTask(DagCapableTask{ID: "B", DependsOn: []string{"A"}})
	m.AddTask(DagCapableTask{ID: "A"})

	result, err := m.TopologicalSort()
	require.NoError(t, err)
	require.Len(t, result, 4)
	assert.Equal(t, "A", result[0].ID)
	assert.Equal(t, "D", result[3].ID)
}

// TestTopologicalSortWithCycle verifies that a cyclic graph returns
// an error instead of a partial result.
func TestTopologicalSortWithCycle(t *testing.T) {
	m := NewManager()
	m.AddTask(DagCapableTask{ID: "A"})
	m.AddTask(DagCapableTask{ID: "B", DependsOn: []string{"A"}})
	m.AddDependency("A", "B")

	result, err := m.TopologicalSort()
	assert.Error(t, err)
	assert.Nil(t, result)
}

// TestTopologicalSortEmpty verifies that an empty graph returns an
// empty slice without error.
func TestTopologicalSortEmpty(t *testing.T) {
	m := NewManager()
	result, err := m.TopologicalSort()
	assert.NoError(t, err)
	assert.Empty(t, result)
}

// TestGetStats verifies that stats correctly reflect the graph state
// after a series of operations.
func TestGetStats(t *testing.T) {
	m := NewManager()
	m.AddTask(DagCapableTask{ID: "A", Priority: 1})
	m.AddTask(DagCapableTask{ID: "B", DependsOn: []string{"A"}, Priority: 1})
	m.AddTask(DagCapableTask{ID: "C", DependsOn: []string{"B"}, Priority: 1})

	m.MarkCompleted("A")
	m.MarkFailed("B")

	stats := m.GetStats()
	assert.Equal(t, 3, stats.TaskCount)
	assert.Equal(t, 2, stats.DependencyCount)
	assert.Equal(t, 1, stats.CompletedCount)
	assert.Equal(t, 1, stats.FailedCount)
	assert.Equal(t, 1, stats.CascadedCount, "C should be cascaded")
	assert.Equal(t, 0, stats.ReadyCount)
}

// TestIsCompleted verifies the completion check.
func TestIsCompleted(t *testing.T) {
	m := NewManager()
	m.AddTask(DagCapableTask{ID: "A"})

	assert.False(t, m.IsCompleted("A"))
	m.MarkCompleted("A")
	assert.True(t, m.IsCompleted("A"))
	assert.False(t, m.IsCompleted("nonexistent"))
}

// TestIsFailedOrCanceled verifies the failure/cascade check.
func TestIsFailedOrCanceled(t *testing.T) {
	m := NewManager()
	m.AddTask(DagCapableTask{ID: "A"})
	m.AddTask(DagCapableTask{ID: "B", DependsOn: []string{"A"}})

	assert.False(t, m.IsFailedOrCanceled("A"))
	assert.False(t, m.IsFailedOrCanceled("B"))

	m.MarkFailed("A")
	assert.True(t, m.IsFailedOrCanceled("A"))
	assert.True(t, m.IsFailedOrCanceled("B"), "B should be cascaded")
}

// TestClear verifies that Clear resets the manager to an empty state.
func TestClear(t *testing.T) {
	m := NewManager()
	m.AddTask(DagCapableTask{ID: "A", Priority: 1})
	m.AddTask(DagCapableTask{ID: "B", DependsOn: []string{"A"}, Priority: 1})
	m.MarkCompleted("A")

	m.Clear()

	stats := m.GetStats()
	assert.Equal(t, 0, stats.TaskCount)
	assert.Equal(t, 0, stats.CompletedCount)
	assert.False(t, m.IsCompleted("A"))
}

// TestAreDependenciesMetNonExistent verifies that checking dependencies
// for a non-existent task returns true (no deps = met).
func TestAreDependenciesMetNonExistent(t *testing.T) {
	m := NewManager()
	assert.True(t, m.AreDependenciesMet("nonexistent"))
}

// TestAddTaskReplacesExisting verifies that re-adding a task preserves
// its existing dependency edges.
func TestAddTaskReplacesExisting(t *testing.T) {
	m := NewManager()
	m.AddTask(DagCapableTask{ID: "A", Priority: 1})
	m.AddTask(DagCapableTask{ID: "B", DependsOn: []string{"A"}, Priority: 1})

	m.AddTask(DagCapableTask{ID: "A", Priority: 5})

	stats := m.GetStats()
	assert.Equal(t, 2, stats.TaskCount)
	assert.Equal(t, 1, stats.DependencyCount, "dependency B��A should be preserved")
	assert.False(t, m.AreDependenciesMet("B"), "B should still depend on A")
}
