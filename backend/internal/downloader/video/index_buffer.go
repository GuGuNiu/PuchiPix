package video

import (
	"fmt"
	"io"
	"os"
	"sync"
)

// BufferMode 定义 IndexBuffer 的存储模式
type BufferMode int

const (
	// MemoryMode 内存模式：适用于小文件，分片数据直接存储在内存中
	MemoryMode BufferMode = iota
	// DiskMode 磁盘模式：适用于大文件，分片数据存储在临时文件中
	DiskMode
)

// SegmentEntry 表示一个下载完成的分片
type SegmentEntry struct {
	Index    int
	Data     []byte // 内存模式：直接存储数据
	FilePath string // 磁盘模式：存储临时文件路径
	Ready    bool   // 是否已下载完成
	Size     int64  // 分片大小
	IsDisk   bool   // 是否为磁盘模式
}

// IndexBuffer 按索引存储分片，支持乱序到达、顺序消费
// 借鉴 cat-catch 的 buffer[index] 设计（研学文档 §2.5.1）
type IndexBuffer struct {
	segments  []*SegmentEntry
	pushIndex int
	totalSize int64
	mu        sync.Mutex
	cond      *sync.Cond
	mode      BufferMode
	cancelled bool // 是否已取消，用于唤醒阻塞的 goroutine
}

// NewIndexBuffer 创建一个新的 IndexBuffer
// count: 分片总数
// mode: 存储模式（MemoryMode 或 DiskMode）
func NewIndexBuffer(count int, mode BufferMode) *IndexBuffer {
	buf := &IndexBuffer{
		segments: make([]*SegmentEntry, count),
		mode:     mode,
	}
	buf.cond = sync.NewCond(&buf.mu)
	return buf
}

// Cancel 取消缓冲区操作，唤醒所有阻塞的 goroutine
// 用于防止 goroutine 泄漏，当调用方需要停止操作时调用
func (b *IndexBuffer) Cancel() {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.cancelled = true
	b.cond.Broadcast() // 唤醒所有等待者
}

// IsCancelled 检查是否已取消
func (b *IndexBuffer) IsCancelled() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.cancelled
}

// Store 存储一个下载完成的分片
// 如果 index 超出范围，返回 error
func (b *IndexBuffer) Store(index int, data []byte) error {
	if index < 0 || index >= len(b.segments) {
		return fmt.Errorf("index %d out of range [0, %d)", index, len(b.segments))
	}

	b.mu.Lock()
	defer b.mu.Unlock()

	entry := &SegmentEntry{
		Index:  index,
		Data:   data,
		Ready:  true,
		Size:   int64(len(data)),
		IsDisk: false,
	}
	b.segments[index] = entry
	b.totalSize += entry.Size

	// 唤醒可能在等待的顺序推送 goroutine
	b.cond.Broadcast()
	return nil
}

// StoreDisk 存储一个下载完成的分片（磁盘模式）
// filePath: 分片文件的磁盘路径
func (b *IndexBuffer) StoreDisk(index int, filePath string, size int64) error {
	if index < 0 || index >= len(b.segments) {
		return fmt.Errorf("index %d out of range [0, %d)", index, len(b.segments))
	}

	b.mu.Lock()
	defer b.mu.Unlock()

	entry := &SegmentEntry{
		Index:    index,
		FilePath: filePath,
		Ready:    true,
		Size:     size,
		IsDisk:   true,
	}
	b.segments[index] = entry
	b.totalSize += size

	// 唤醒可能在等待的顺序推送 goroutine
	b.cond.Broadcast()
	return nil
}

// SequentialPush 按顺序将分片推送到 writer
// 遇到未就绪的索引时阻塞等待
// 返回写入的总字节数和任何错误
// 如果 Cancel() 被调用，会返回 context.Canceled 错误
func (b *IndexBuffer) SequentialPush(w io.Writer) (int64, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	var written int64
	for b.pushIndex < len(b.segments) {
		// 检查是否已取消
		if b.cancelled {
			return written, fmt.Errorf("index buffer cancelled")
		}

		entry := b.segments[b.pushIndex]
		if entry == nil || !entry.Ready {
			// 等待该索引的分片就绪
			b.cond.Wait()
			// 唤醒后检查是否已取消
			if b.cancelled {
				return written, fmt.Errorf("index buffer cancelled")
			}
			continue
		}

		// 写入分片数据
		n, err := b.writeEntry(w, entry)
		if err != nil {
			return written, fmt.Errorf("write segment %d: %w", b.pushIndex, err)
		}
		written += n

		// 清理已消费的分片（释放内存或删除临时文件）
		b.cleanupEntry(entry)

		b.pushIndex++
		b.cond.Broadcast()
	}

	return written, nil
}

// SequentialPushWithCallback 按顺序推送，并在每个分片写入后调用回调
// 如果 Cancel() 被调用，会返回错误
func (b *IndexBuffer) SequentialPushWithCallback(w io.Writer, onSegment func(index int, size int64)) (int64, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	var written int64
	for b.pushIndex < len(b.segments) {
		// 检查是否已取消
		if b.cancelled {
			return written, fmt.Errorf("index buffer cancelled")
		}

		entry := b.segments[b.pushIndex]
		if entry == nil || !entry.Ready {
			b.cond.Wait()
			// 唤醒后检查是否已取消
			if b.cancelled {
				return written, fmt.Errorf("index buffer cancelled")
			}
			continue
		}

		n, err := b.writeEntry(w, entry)
		if err != nil {
			return written, fmt.Errorf("write segment %d: %w", b.pushIndex, err)
		}
		written += n

		if onSegment != nil {
			onSegment(b.pushIndex, n)
		}

		b.cleanupEntry(entry)
		b.pushIndex++
		b.cond.Broadcast()
	}

	return written, nil
}

// writeEntry 将单个分片写入 writer
func (b *IndexBuffer) writeEntry(w io.Writer, entry *SegmentEntry) (int64, error) {
	if entry.IsDisk {
		// 磁盘模式：从文件流式读取
		f, err := os.Open(entry.FilePath)
		if err != nil {
			return 0, fmt.Errorf("open segment file: %w", err)
		}
		defer f.Close()
		return io.Copy(w, f)
	}
	// 内存模式：直接写入
	n, err := w.Write(entry.Data)
	return int64(n), err
}

// cleanupEntry 清理已消费的分片
func (b *IndexBuffer) cleanupEntry(entry *SegmentEntry) {
	if entry.IsDisk && entry.FilePath != "" {
		// 删除临时文件
		_ = os.Remove(entry.FilePath)
	}
	// 内存模式：GC 会自动回收
	entry.Data = nil
}

// WaitForIndex 阻塞等待指定索引的分片就绪
// 如果 Cancel() 被调用，会立即返回
func (b *IndexBuffer) WaitForIndex(index int) {
	b.mu.Lock()
	defer b.mu.Unlock()

	for {
		// 检查是否已取消
		if b.cancelled {
			return
		}

		if index < len(b.segments) {
			entry := b.segments[index]
			if entry != nil && entry.Ready {
				return
			}
		}
		b.cond.Wait()
	}
}

// IsComplete 检查所有分片是否都已就绪
func (b *IndexBuffer) IsComplete() bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	for _, entry := range b.segments {
		if entry == nil || !entry.Ready {
			return false
		}
	}
	return true
}

// GetProgress 返回当前进度（已就绪的分片数 / 总分片数）
func (b *IndexBuffer) GetProgress() (ready, total int) {
	b.mu.Lock()
	defer b.mu.Unlock()

	total = len(b.segments)
	for _, entry := range b.segments {
		if entry != nil && entry.Ready {
			ready++
		}
	}
	return ready, total
}

// GetPushProgress 返回顺序推送的进度
func (b *IndexBuffer) GetPushProgress() (pushed, total int) {
	b.mu.Lock()
	defer b.mu.Unlock()

	return b.pushIndex, len(b.segments)
}

// TotalSize 返回所有分片的总大小
func (b *IndexBuffer) TotalSize() int64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.totalSize
}

// Reset 重置缓冲区状态，用于重试场景
func (b *IndexBuffer) Reset() {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.pushIndex = 0
	b.totalSize = 0
	// 注意：不清理 segments，因为可能还有有效的分片
}
