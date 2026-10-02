package video

import (
	"context"
	"fmt"
	"io"
	"os"
	"sync"
	"time"

	"backend/internal/infra"
)

var streamMergerLogger = infra.NewLogger("StreamMerger")

type StreamMergerConfig struct {
	Mode             BufferMode
	TempDir          string
	ProgressCallback func(segmentIndex int, segmentSize int64)
	Logger           *infra.Logger
}

// StreamMerger merges segments while they download (stream-as-you-go).
type StreamMerger struct {
	buffer *IndexBuffer
	config StreamMergerConfig
}

func NewStreamMerger(segmentCount int, config StreamMergerConfig) *StreamMerger {
	if config.Logger == nil {
		config.Logger = streamMergerLogger
	}
	return &StreamMerger{
		buffer: NewIndexBuffer(segmentCount, config.Mode),
		config: config,
	}
}

func (m *StreamMerger) StoreSegment(index int, data []byte) error {
	return m.buffer.Store(index, data)
}

func (m *StreamMerger) StoreSegmentDisk(index int, filePath string, size int64) error {
	return m.buffer.StoreDisk(index, filePath, size)
}

// MergeToWriter merges segments in order into w, blocking until all
// segments are ready and written.
func (m *StreamMerger) MergeToWriter(w io.Writer) (int64, error) {
	var callback func(int, int64)
	if m.config.ProgressCallback != nil {
		callback = m.config.ProgressCallback
	}
	return m.buffer.SequentialPushWithCallback(w, callback)
}

func (m *StreamMerger) MergeToFile(outputPath string) (int64, error) {
	if err := os.MkdirAll(m.config.TempDir, 0755); err != nil {
		return 0, fmt.Errorf("create temp directory: %w", err)
	}

	f, err := os.Create(outputPath)
	if err != nil {
		return 0, fmt.Errorf("create output file: %w", err)
	}
	defer f.Close()

	return m.MergeToWriter(&infra.CountingWriter{W: f})
}

// MergeToPipe streams merged segments through an io.Pipe, for
// stream-transcode scenarios. Returns a ReadCloser the caller can read
// the merged stream from.
func (m *StreamMerger) MergeToPipe() (io.ReadCloser, *sync.WaitGroup, error) {
	pr, pw := io.Pipe()
	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		defer pw.Close()

		_, err := m.buffer.SequentialPushWithCallback(pw, m.config.ProgressCallback)
		if err != nil {
			pw.CloseWithError(err)
		}
	}()

	return pr, &wg, nil
}

func (m *StreamMerger) GetBuffer() *IndexBuffer {
	return m.buffer
}

func (m *StreamMerger) Cancel() {
	m.buffer.Cancel()
}

// StreamingMergePipeline runs the full streaming merge pipeline;
// download and merge goroutines run in parallel.
type StreamingMergePipeline struct {
	merger   *StreamMerger
	output   io.WriteCloser
	ctx      context.Context
	cancel   context.CancelFunc
	doneChan chan error
	mu       sync.Mutex
	started  bool
}

func NewStreamingMergePipeline(segmentCount int, config StreamMergerConfig, output io.WriteCloser) *StreamingMergePipeline {
	ctx, cancel := context.WithCancel(context.Background())
	return &StreamingMergePipeline{
		merger:   NewStreamMerger(segmentCount, config),
		output:   output,
		ctx:      ctx,
		cancel:   cancel,
		doneChan: make(chan error, 1),
	}
}

func (p *StreamingMergePipeline) StoreSegment(index int, data []byte) error {
	return p.merger.StoreSegment(index, data)
}

func (p *StreamingMergePipeline) StoreSegmentDisk(index int, filePath string, size int64) error {
	return p.merger.StoreSegmentDisk(index, filePath, size)
}

// Start launches the merge goroutine. After this call, StoreSegment
// results are consumed in order and written to output.
func (p *StreamingMergePipeline) Start() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.started {
		return fmt.Errorf("pipeline already started")
	}
	p.started = true

	go func() {
		_, err := p.merger.MergeToWriter(p.output)
		p.doneChan <- err
		p.cancel()
	}()

	return nil
}

func (p *StreamingMergePipeline) Wait() error {
	err := <-p.doneChan
	return err
}

func (p *StreamingMergePipeline) Cancel() {
	p.merger.Cancel()
	p.cancel()
}

func (p *StreamingMergePipeline) GetProgress() (ready, total int) {
	return p.merger.buffer.GetProgress()
}

func (p *StreamingMergePipeline) GetPushProgress() (pushed, total int) {
	return p.merger.buffer.GetPushProgress()
}

// CreateStreamMergerForTask creates a streaming merger for a download task.
func CreateStreamMergerForTask(taskID int, segmentCount int, segDir string, mode BufferMode) *StreamMerger {
	config := StreamMergerConfig{
		Mode:    mode,
		TempDir: segDir,
		Logger:  streamMergerLogger,
	}

	logger := config.Logger
	if logger != nil {
		if mode == MemoryMode {
			logger.Info("创建内存模式流式合并器",
				infra.LogContext{Extra: map[string]any{
					"taskId":   taskID,
					"segments": segmentCount,
				}})
		} else {
			logger.Info("创建磁盘模式流式合并器",
				infra.LogContext{Extra: map[string]any{
					"taskId":   taskID,
					"segments": segmentCount,
				}})
		}
	}

	merger := NewStreamMerger(segmentCount, config)
	return merger
}

// DetermineBufferMode picks the storage mode from the estimated total size.
func DetermineBufferMode(segmentCount int, avgSegmentSize int64) BufferMode {
	estimatedTotal := int64(segmentCount) * avgSegmentSize
	const memoryThreshold = 100 * 1024 * 1024
	if estimatedTotal < memoryThreshold {
		return MemoryMode
	}
	return DiskMode
}

func CleanupSegmentFile(filePath string) {
	if filePath != "" {
		_ = os.Remove(filePath)
	}
}

type SegmentDownloadInfo struct {
	Index    int
	FilePath string
	Size     int64
	IsDisk   bool
}

// BatchStoreSegments stores segments in bulk (after a disk-mode batch download).
func (m *StreamMerger) BatchStoreSegments(segments []SegmentDownloadInfo) error {
	for _, seg := range segments {
		if seg.IsDisk {
			if err := m.StoreSegmentDisk(seg.Index, seg.FilePath, seg.Size); err != nil {
				return fmt.Errorf("store segment %d: %w", seg.Index, err)
			}
		} else {
			data, err := os.ReadFile(seg.FilePath)
			if err != nil {
				return fmt.Errorf("read segment %d file: %w", seg.Index, err)
			}
			if err := m.StoreSegment(seg.Index, data); err != nil {
				return fmt.Errorf("store segment %d: %w", seg.Index, err)
			}
			_ = os.Remove(seg.FilePath)
		}
	}
	return nil
}

// SegmentTimeInfo holds per-segment timing used for download speed calculation.
type SegmentTimeInfo struct {
	Index     int
	StartTime time.Time
	EndTime   time.Time
	Size      int64
}

func CalculateDownloadSpeed(stats []SegmentTimeInfo) float64 {
	if len(stats) == 0 {
		return 0
	}
	var totalSize int64
	var totalDuration time.Duration
	for _, s := range stats {
		totalSize += s.Size
		totalDuration += s.EndTime.Sub(s.StartTime)
	}
	if totalDuration == 0 {
		return 0
	}
	return float64(totalSize) / totalDuration.Seconds()
}
