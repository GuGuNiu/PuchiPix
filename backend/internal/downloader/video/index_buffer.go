package video

import (
	"fmt"
	"io"
	"os"
	"sync"
)

type BufferMode int

const (
	// MemoryMode keeps segment data in memory — for small files.
	MemoryMode BufferMode = iota
	// DiskMode stores segment data in temp files — for large files.
	DiskMode
)

type SegmentEntry struct {
	Index    int
	Data     []byte
	FilePath string
	Ready    bool
	Size     int64
	IsDisk   bool
}

// IndexBuffer stores segments by index so they can arrive out of order and
// still be consumed in order.
type IndexBuffer struct {
	segments  []*SegmentEntry
	pushIndex int
	totalSize int64
	mu        sync.Mutex
	cond      *sync.Cond
	pushMu    sync.Mutex
	mode      BufferMode
	cancelled bool
}

func NewIndexBuffer(count int, mode BufferMode) *IndexBuffer {
	buf := &IndexBuffer{
		segments: make([]*SegmentEntry, count),
		mode:     mode,
	}
	buf.cond = sync.NewCond(&buf.mu)
	return buf
}

// Cancel unblocks every waiting goroutine, preventing leaks when the
// caller must abort the download.
func (b *IndexBuffer) Cancel() {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.cancelled = true
	b.cond.Broadcast()
}

func (b *IndexBuffer) IsCancelled() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.cancelled
}

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

	b.cond.Broadcast()
	return nil
}

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

	b.cond.Broadcast()
	return nil
}

// SequentialPush writes segments to w in order, blocking on indices that
// are not ready yet. Reports an error once Cancel has been called.
func (b *IndexBuffer) SequentialPush(w io.Writer) (int64, error) {
	return b.sequentialPush(w, nil)
}

func (b *IndexBuffer) SequentialPushWithCallback(w io.Writer, onSegment func(index int, size int64)) (int64, error) {
	return b.sequentialPush(w, onSegment)
}

func (b *IndexBuffer) sequentialPush(w io.Writer, onSegment func(index int, size int64)) (int64, error) {
	b.pushMu.Lock()
	defer b.pushMu.Unlock()

	var written int64
	for {
		b.mu.Lock()
		if b.cancelled {
			b.mu.Unlock()
			return written, fmt.Errorf("index buffer cancelled")
		}
		if b.pushIndex >= len(b.segments) {
			b.mu.Unlock()
			return written, nil
		}

		entry := b.segments[b.pushIndex]
		if entry == nil || !entry.Ready {
			b.cond.Wait()
			b.mu.Unlock()
			continue
		}
		index := b.pushIndex
		entryCopy := *entry
		b.mu.Unlock()

		n, err := b.writeEntry(w, &entryCopy)
		if err != nil {
			return written, fmt.Errorf("write segment %d: %w", index, err)
		}
		written += n

		if onSegment != nil {
			onSegment(index, n)
		}

		b.mu.Lock()
		if b.cancelled {
			if b.segments[index] == entry {
				b.cleanupEntry(entry)
			}
			b.mu.Unlock()
			return written, fmt.Errorf("index buffer cancelled")
		}
		if b.segments[index] == entry {
			b.cleanupEntry(entry)
		}
		b.pushIndex = index + 1
		b.cond.Broadcast()
		b.mu.Unlock()
	}
}

func (b *IndexBuffer) writeEntry(w io.Writer, entry *SegmentEntry) (int64, error) {
	if entry.IsDisk {
		f, err := os.Open(entry.FilePath)
		if err != nil {
			return 0, fmt.Errorf("open segment file: %w", err)
		}
		defer f.Close()
		return io.Copy(w, f)
	}
	n, err := w.Write(entry.Data)
	return int64(n), err
}

func (b *IndexBuffer) cleanupEntry(entry *SegmentEntry) {
	if entry.IsDisk && entry.FilePath != "" {
		_ = os.Remove(entry.FilePath)
	}
	// Dropping the reference lets the GC reclaim the segment buffer.
	entry.Data = nil
}

// WaitForIndex blocks until the segment at index is ready, returning
// immediately once Cancel has been called.
func (b *IndexBuffer) WaitForIndex(index int) {
	b.mu.Lock()
	defer b.mu.Unlock()

	for {
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

func (b *IndexBuffer) GetPushProgress() (pushed, total int) {
	b.mu.Lock()
	defer b.mu.Unlock()

	return b.pushIndex, len(b.segments)
}

func (b *IndexBuffer) TotalSize() int64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.totalSize
}

// Reset clears push and size state so a retry can start over.
func (b *IndexBuffer) Reset() {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.pushIndex = 0
	b.totalSize = 0
	// Segments are kept: valid entries may still be present.
}
