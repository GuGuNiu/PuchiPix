package dag

import (
	"fmt"
	"sync"
)

// DagTaskID is the identifier for a task in the DAG dependency graph.
type DagTaskID = string

// DagCapableTask represents a task that can participate in the DAG
// dependency graph, carrying its ID, priority, and dependency list.
type DagCapableTask struct {
	ID        DagTaskID
	Priority  int
	DependsOn []DagTaskID
}

// DagStats reports aggregate graph metrics for monitoring.
type DagStats struct {
	TaskCount        int
	DependencyCount  int
	CompletedCount   int
	FailedCount      int
	CascadedCount    int
	ReadyCount       int
}

// CycleError is returned when the dependency graph contains a cycle,
// making topological ordering impossible.
type CycleError struct {
	CyclePath []DagTaskID
}

func (e *CycleError) Error() string {
	path := ""
	for i, id := range e.CyclePath {
		if i > 0 {
			path += " -> "
		}
		path += id
	}
	return fmt.Sprintf("cycle detected: %s", path)
}

// Manager manages a task dependency graph with Kahn's algorithm for
// topological sorting and cycle detection, and incremental ready-set
// updates as tasks complete or fail.
type Manager struct {
	mu           sync.Mutex
	tasks        map[DagTaskID]*DagCapableTask
	dependencies map[DagTaskID]map[DagTaskID]bool
	dependents   map[DagTaskID]map[DagTaskID]bool
	completed    map[DagTaskID]bool
	failed       map[DagTaskID]bool
	cascaded     map[DagTaskID]bool
	readySet     map[DagTaskID]bool
	placeholders map[DagTaskID]bool
}

// NewManager creates an empty DAG manager.
func NewManager() *Manager {
	return &Manager{
		tasks:        make(map[DagTaskID]*DagCapableTask),
		dependencies: make(map[DagTaskID]map[DagTaskID]bool),
		dependents:   make(map[DagTaskID]map[DagTaskID]bool),
		completed:    make(map[DagTaskID]bool),
		failed:       make(map[DagTaskID]bool),
		cascaded:     make(map[DagTaskID]bool),
		readySet:     make(map[DagTaskID]bool),
		placeholders: make(map[DagTaskID]bool),
	}
}

// AddTask registers a task in the DAG. If the task already exists, it
// is replaced, but its dependency edges are preserved.
func (m *Manager) AddTask(task DagCapableTask) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id := task.ID
	m.tasks[id] = &task
	delete(m.placeholders, id)

	if _, ok := m.dependencies[id]; !ok {
		m.dependencies[id] = make(map[DagTaskID]bool)
		m.dependents[id] = make(map[DagTaskID]bool)
	}

	for _, depID := range task.DependsOn {
		m.addDependencyLocked(id, depID)
	}

	if m.areDependenciesMetLocked(id) {
		m.readySet[id] = true
	}
}

// addDependencyLocked is the internal dependency registration without
// locking, assuming the caller already holds the lock.
func (m *Manager) addDependencyLocked(taskID, depID DagTaskID) {
	if taskID == depID {
		panic(&CycleError{CyclePath: []DagTaskID{taskID, taskID}})
	}

	if _, ok := m.dependencies[taskID]; !ok {
		m.dependencies[taskID] = make(map[DagTaskID]bool)
		m.dependents[taskID] = make(map[DagTaskID]bool)
	}
	if _, ok := m.dependencies[depID]; !ok {
		m.dependencies[depID] = make(map[DagTaskID]bool)
		m.dependents[depID] = make(map[DagTaskID]bool)
		m.placeholders[depID] = true
		placeholder := DagCapableTask{ID: depID}
		m.tasks[depID] = &placeholder
	}

	m.dependencies[taskID][depID] = true
	m.dependents[depID][taskID] = true

	if !m.areDependenciesMetLocked(taskID) {
		delete(m.readySet, taskID)
	}
}

// AddDependency registers a dependency between two tasks. The dependent
// task must already exist; the dependency task is created as a placeholder
// if it does not yet exist.
func (m *Manager) AddDependency(taskID, depID DagTaskID) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.addDependencyLocked(taskID, depID)
}

// AreDependenciesMet checks whether all dependencies of a task are
// completed and the task itself has not failed or been cascaded.
func (m *Manager) AreDependenciesMet(taskID DagTaskID) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.areDependenciesMetLocked(taskID)
}

func (m *Manager) areDependenciesMetLocked(taskID DagTaskID) bool {
	if m.failed[taskID] || m.cascaded[taskID] {
		return false
	}
	deps, ok := m.dependencies[taskID]
	if !ok || len(deps) == 0 {
		return true
	}
	for depID := range deps {
		if !m.completed[depID] {
			return false
		}
	}
	return true
}

// MarkCompleted marks a task as completed and returns newly unblocked
// dependent task IDs whose dependencies are now all satisfied.
func (m *Manager) MarkCompleted(taskID DagTaskID) []DagTaskID {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.completed[taskID] = true
	delete(m.readySet, taskID)

	var newlyUnblocked []DagTaskID
	for depID := range m.dependents[taskID] {
		if m.areDependenciesMetLocked(depID) {
			m.readySet[depID] = true
			newlyUnblocked = append(newlyUnblocked, depID)
		}
	}
	return newlyUnblocked
}

// MarkFailed marks a task as failed and cascades the failure to all
// transitive dependents that cannot proceed without it.
func (m *Manager) MarkFailed(taskID DagTaskID) []DagTaskID {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.failed[taskID] = true
	delete(m.readySet, taskID)

	var cascadedIDs []DagTaskID
	queue := []DagTaskID{taskID}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		for depID := range m.dependents[current] {
			if m.cascaded[depID] || m.failed[depID] {
				continue
			}
			m.cascaded[depID] = true
			delete(m.readySet, depID)
			cascadedIDs = append(cascadedIDs, depID)
			queue = append(queue, depID)
		}
	}
	return cascadedIDs
}

// GetNextExecutable selects the highest-priority task from candidates
// that are in the ready set. If there are no dependencies, any
// candidate is eligible.
func (m *Manager) GetNextExecutable(candidates []*DagCapableTask) *DagCapableTask {
	m.mu.Lock()
	defer m.mu.Unlock()

	if len(candidates) == 0 {
		return nil
	}

	depEdgeCount := 0
	for _, deps := range m.dependencies {
		depEdgeCount += len(deps)
	}
	if depEdgeCount == 0 {
		return m.pickHighestPriorityLocked(candidates)
	}

	var ready []*DagCapableTask
	for _, c := range candidates {
		if m.readySet[c.ID] {
			ready = append(ready, c)
		}
	}
	if len(ready) == 0 {
		return nil
	}
	return m.pickHighestPriorityLocked(ready)
}

func (m *Manager) pickHighestPriorityLocked(candidates []*DagCapableTask) *DagCapableTask {
	if len(candidates) == 0 {
		return nil
	}
	best := candidates[0]
	for i := 1; i < len(candidates); i++ {
		if candidates[i].Priority > best.Priority {
			best = candidates[i]
		}
	}
	return best
}

// DetectCycles uses Kahn's algorithm to detect cycles in the
// dependency graph, returning a CycleError if one is found.
func (m *Manager) DetectCycles() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	inDegree := make(map[DagTaskID]int, len(m.tasks))
	for id := range m.tasks {
		inDegree[id] = len(m.dependencies[id])
	}

	var queue []DagTaskID
	for id, deg := range inDegree {
		if deg == 0 {
			queue = append(queue, id)
		}
	}

	processed := 0
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		processed++

		for depID := range m.dependents[current] {
			inDegree[depID]--
			if inDegree[depID] == 0 {
				queue = append(queue, depID)
			}
		}
	}

	if processed < len(m.tasks) {
		remaining := make(map[DagTaskID]bool)
		for id, deg := range inDegree {
			if deg > 0 {
				remaining[id] = true
			}
		}
		cyclePath := m.findCyclePathLocked(remaining)
		return &CycleError{CyclePath: cyclePath}
	}
	return nil
}

// TopologicalSort returns all tasks in dependency order, or an error
// if a cycle prevents a valid ordering.
func (m *Manager) TopologicalSort() ([]*DagCapableTask, error) {
	if err := m.DetectCycles(); err != nil {
		return nil, err
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	inDegree := make(map[DagTaskID]int, len(m.tasks))
	for id := range m.tasks {
		inDegree[id] = len(m.dependencies[id])
	}

	var queue []DagTaskID
	for id, deg := range inDegree {
		if deg == 0 {
			queue = append(queue, id)
		}
	}

	var result []*DagCapableTask
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		if task, ok := m.tasks[current]; ok {
			result = append(result, task)
		}
		for depID := range m.dependents[current] {
			inDegree[depID]--
			if inDegree[depID] == 0 {
				queue = append(queue, depID)
			}
		}
	}
	return result, nil
}

func (m *Manager) findCyclePathLocked(remaining map[DagTaskID]bool) []DagTaskID {
	if len(remaining) == 0 {
		return nil
	}

	var start DagTaskID
	for id := range remaining {
		start = id
		break
	}

	path := []DagTaskID{start}
	visited := map[DagTaskID]bool{start: true}
	current := start

	for {
		deps := m.dependencies[current]
		var next DagTaskID
		found := false
		for dep := range deps {
			if remaining[dep] {
				next = dep
				found = true
				break
			}
		}
		if !found {
			break
		}

		if visited[next] {
			cycleStart := 0
			for i, id := range path {
				if id == next {
					cycleStart = i
					break
				}
			}
			return append(path[cycleStart:], next)
		}

		path = append(path, next)
		visited[next] = true
		current = next
	}
	return path
}

// GetStats returns aggregate graph metrics.
func (m *Manager) GetStats() DagStats {
	m.mu.Lock()
	defer m.mu.Unlock()

	depCount := 0
	for _, deps := range m.dependencies {
		depCount += len(deps)
	}
	return DagStats{
		TaskCount:       len(m.tasks),
		DependencyCount: depCount,
		CompletedCount:  len(m.completed),
		FailedCount:      len(m.failed),
		CascadedCount:   len(m.cascaded),
		ReadyCount:      len(m.readySet),
	}
}

// IsCompleted reports whether a task has been marked completed.
func (m *Manager) IsCompleted(id DagTaskID) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.completed[id]
}

// IsFailedOrCanceled reports whether a task has failed or been cascaded.
func (m *Manager) IsFailedOrCanceled(id DagTaskID) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.failed[id] || m.cascaded[id]
}

// Clear removes all tasks and state from the manager.
func (m *Manager) Clear() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.tasks = make(map[DagTaskID]*DagCapableTask)
	m.dependencies = make(map[DagTaskID]map[DagTaskID]bool)
	m.dependents = make(map[DagTaskID]map[DagTaskID]bool)
	m.completed = make(map[DagTaskID]bool)
	m.failed = make(map[DagTaskID]bool)
	m.cascaded = make(map[DagTaskID]bool)
	m.readySet = make(map[DagTaskID]bool)
	m.placeholders = make(map[DagTaskID]bool)
}
