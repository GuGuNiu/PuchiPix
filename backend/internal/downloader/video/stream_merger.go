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

// StreamMergerConfig 配置流式合并器的行为
type StreamMergerConfig struct {
	// Mode 定义存储模式
	Mode BufferMode
	// TempDir 磁盘模式下的临时文件目录
	TempDir string
	// ProgressCallback 进度回调
	ProgressCallback func(segmentIndex int, segmentSize int64)
	// Logger 日志记录器
	Logger *infra.Logger
}

// StreamMerger 实现边下边合并的流式合并器
// 借鉴 cat-catch 的 sequentialPush 设计（研学文档 §2.5.1）
type StreamMerger struct {
	buffer *IndexBuffer
	config StreamMergerConfig
}

// NewStreamMerger 创建一个新的流式合并器
func NewStreamMerger(segmentCount int, config StreamMergerConfig) *StreamMerger {
	if config.Logger == nil {
		config.Logger = streamMergerLogger
	}
	return &StreamMerger{
		buffer: NewIndexBuffer(segmentCount, config.Mode),
		config: config,
	}
}

// StoreSegment 存储一个下载完成的分片
func (m *StreamMerger) StoreSegment(index int, data []byte) error {
	return m.buffer.Store(index, data)
}

// StoreSegmentDisk 存储一个下载完成的分片（磁盘模式）
func (m *StreamMerger) StoreSegmentDisk(index int, filePath string, size int64) error {
	return m.buffer.StoreDisk(index, filePath, size)
}

// MergeToWriter 将分片按顺序合并到指定的 writer
// 此方法会阻塞直到所有分片就绪并写入完成
func (m *StreamMerger) MergeToWriter(w io.Writer) (int64, error) {
	var callback func(int, int64)
	if m.config.ProgressCallback != nil {
		callback = m.config.ProgressCallback
	}
	return m.buffer.SequentialPushWithCallback(w, callback)
}

// MergeToFile 将分片按顺序合并到指定文件
func (m *StreamMerger) MergeToFile(outputPath string) (int64, error) {
	if err := os.MkdirAll(m.config.TempDir, 0755); err != nil {
		return 0, fmt.Errorf("create temp directory: %w", err)
	}

	f, err := os.Create(outputPath)
	if err != nil {
		return 0, fmt.Errorf("create output file: %w", err)
	}
	defer f.Close()

	return m.MergeToWriter(f)
}

// MergeToPipe 将分片通过 io.Pipe 输出，适用于流式转码场景
// 返回一个 ReadCloser，调用者可以读取合并后的数据流
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

// GetBuffer 返回内部的 IndexBuffer，用于直接访问
func (m *StreamMerger) GetBuffer() *IndexBuffer {
	return m.buffer
}

// StreamingMergePipeline 实现完整的流式合并管道
// 下载 goroutine 和合并 goroutine 并行执行
type StreamingMergePipeline struct {
	merger    *StreamMerger
	output    io.WriteCloser
	ctx       context.Context
	cancel    context.CancelFunc
	doneChan  chan error
	mu        sync.Mutex
	started   bool
}

// NewStreamingMergePipeline 创建一个新的流式合并管道
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

// StoreSegment 存储一个下载完成的分片（并发安全）
func (p *StreamingMergePipeline) StoreSegment(index int, data []byte) error {
	return p.merger.StoreSegment(index, data)
}

// StoreSegmentDisk 存储一个下载完成的分片（磁盘模式）
func (p *StreamingMergePipeline) StoreSegmentDisk(index int, filePath string, size int64) error {
	return p.merger.StoreSegmentDisk(index, filePath, size)
}

// Start 启动合并 goroutine
// 调用此方法后，StoreSegment 将被顺序消费并写入 output
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

// Wait 等待合并完成
func (p *StreamingMergePipeline) Wait() error {
	err := <-p.doneChan
	return err
}

// Cancel 取消合并操作
func (p *StreamingMergePipeline) Cancel() {
	p.cancel()
}

// GetProgress 返回当前进度
func (p *StreamingMergePipeline) GetProgress() (ready, total int) {
	return p.merger.buffer.GetProgress()
}

// GetPushProgress 返回推送进度
func (p *StreamingMergePipeline) GetPushProgress() (pushed, total int) {
	return p.merger.buffer.GetPushProgress()
}

// ============================================================
// 适配现有 SegmentQueue 的辅助函数
// ============================================================

// CreateStreamMergerForTask 为下载任务创建流式合并器
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
					"taskId":     taskID,
					"segments":   segmentCount,
				}})
		} else {
			logger.Info("创建磁盘模式流式合并器",
				infra.LogContext{Extra: map[string]any{
					"taskId":     taskID,
					"segments":   segmentCount,
				}})
		}
	}

	merger := NewStreamMerger(segmentCount, config)
	return merger
}

// DetermineBufferMode 根据分片总数和预估大小决定存储模式
// 预估总大小 < 100MB 使用内存模式，否则使用磁盘模式
func DetermineBufferMode(segmentCount int, avgSegmentSize int64) BufferMode {
	estimatedTotal := int64(segmentCount) * avgSegmentSize
	const memoryThreshold = 100 * 1024 * 1024 // 100MB
	if estimatedTotal < memoryThreshold {
		return MemoryMode
	}
	return DiskMode
}

// CleanupSegmentFile 清理分片临时文件
func CleanupSegmentFile(filePath string) {
	if filePath != "" {
		_ = os.Remove(filePath)
	}
}

// SegmentDownloadInfo 传递给流式合并器的分片下载信息
type SegmentDownloadInfo struct {
	Index    int
	FilePath string
	Size     int64
	IsDisk   bool
}

// BatchStoreSegments 批量存储分片（用于磁盘模式批量下载后存储）
func (m *StreamMerger) BatchStoreSegments(segments []SegmentDownloadInfo) error {
	for _, seg := range segments {
		if seg.IsDisk {
			if err := m.StoreSegmentDisk(seg.Index, seg.FilePath, seg.Size); err != nil {
				return fmt.Errorf("store segment %d: %w", seg.Index, err)
			}
		} else {
			// 内存模式需要读取文件到内存
			data, err := os.ReadFile(seg.FilePath)
			if err != nil {
				return fmt.Errorf("read segment %d file: %w", seg.Index, err)
			}
			if err := m.StoreSegment(seg.Index, data); err != nil {
				return fmt.Errorf("store segment %d: %w", seg.Index, err)
			}
			// 清理临时文件
			_ = os.Remove(seg.FilePath)
		}
	}
	return nil
}

// SegmentTimeInfo 用于计算下载速度的分片时间信息
type SegmentTimeInfo struct {
	Index      int
	StartTime  time.Time
	EndTime    time.Time
	Size       int64
}

// CalculateDownloadSpeed 计算平均下载速度
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
