package video

import (
	"fmt"
	"io"
	"os"
	"sync"
)

// BufferMode selects the storage mode of an IndexBuffer.
type BufferMode int

const (
	// MemoryMode keeps segment data in memory — for small files.
	MemoryMode BufferMode = iota
	// DiskMode stores segment data in temp files — for large files.
	DiskMode
)

// SegmentEntry is a single downloaded segment.
type SegmentEntry struct {
	Index    int
	Data     []byte // memory mode: raw data
	FilePath string // disk mode: temp file path
	Ready    bool   // download finished
	Size     int64  // segment size
	IsDisk   bool   // disk mode flag
}

// IndexBuffer stores segments by index, supporting out-of-order arrival
// and in-order consumption. Follows cat-catch's buffer[index] design
// (see design doc §2.5.1).
type IndexBuffer struct {
	segments  []*SegmentEntry
	pushIndex int
	totalSize int64
	mu        sync.Mutex
	cond      *sync.Cond
	mode      BufferMode
	cancelled bool // cancellation flag; wakes blocked goroutines
}

// NewIndexBuffer creates an IndexBuffer.
// count: total segment count; mode: MemoryMode or DiskMode.
func NewIndexBuffer(count int, mode BufferMode) *IndexBuffer {
	buf := &IndexBuffer{
		segments: make([]*SegmentEntry, count),
		mode:     mode,
	}
	buf.cond = sync.NewCond(&buf.mu)
	return buf
}

// Cancel aborts buffer operations and wakes all blocked goroutines,
// preventing goroutine leaks when the caller must stop.
func (b *IndexBuffer) Cancel() {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.cancelled = true
	b.cond.Broadcast() // wake all waiters
}

// IsCancelled reports whether Cancel was called.
func (b *IndexBuffer) IsCancelled() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.cancelled
}

// Store saves a downloaded segment; returns an error if index is out of range.
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

	b.cond.Broadcast() // wake any blocked sequential pusher
	return nil
}

// StoreDisk saves a downloaded segment in disk mode.
// filePath: on-disk path of the segment file.
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

	b.cond.Broadcast() // wake any blocked sequential pusher
	return nil
}

// SequentialPush writes segments to w in order, blocking on not-yet-ready
// indices. Returns total bytes written and any error; returns an error if
// Cancel() is called.
func (b *IndexBuffer) SequentialPush(w io.Writer) (int64, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	var written int64
	for b.pushIndex < len(b.segments) {
		if b.cancelled {
			return written, fmt.Errorf("index buffer cancelled")
		}

		entry := b.segments[b.pushIndex]
		if entry == nil || !entry.Ready {
			b.cond.Wait()
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

		b.cleanupEntry(entry) // free memory / delete temp file

		b.pushIndex++
		b.cond.Broadcast()
	}

	return written, nil
}

// SequentialPushWithCallback pushes segments in order, invoking onSegment
// after each write. Returns an error if Cancel() is called.
func (b *IndexBuffer) SequentialPushWithCallback(w io.Writer, onSegment func(index int, size int64)) (int64, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	var written int64
	for b.pushIndex < len(b.segments) {
		if b.cancelled {
			return written, fmt.Errorf("index buffer cancelled")
		}

		entry := b.segments[b.pushIndex]
		if entry == nil || !entry.Ready {
			b.cond.Wait()
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

// writeEntry writes a single segment to w.
func (b *IndexBuffer) writeEntry(w io.Writer, entry *SegmentEntry) (int64, error) {
	if entry.IsDisk {
		// Disk mode: stream from file
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

// cleanupEntry releases a consumed segment.
func (b *IndexBuffer) cleanupEntry(entry *SegmentEntry) {
	if entry.IsDisk && entry.FilePath != "" {
		_ = os.Remove(entry.FilePath) // delete temp file
	}
	entry.Data = nil // memory mode: let GC reclaim
}

// WaitForIndex blocks until the segment at index is ready, or returns
// immediately if Cancel() was called.
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

// IsComplete reports whether all segments are ready.
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

// GetProgress returns ready segments / total segments.
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

// GetPushProgress returns sequential-push progress (pushed, total).
func (b *IndexBuffer) GetPushProgress() (pushed, total int) {
	b.mu.Lock()
	defer b.mu.Unlock()

	return b.pushIndex, len(b.segments)
}

// TotalSize returns the total size of all segments.
func (b *IndexBuffer) TotalSize() int64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.totalSize
}

// Reset clears push/size state for retry scenarios.
func (b *IndexBuffer) Reset() {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.pushIndex = 0
	b.totalSize = 0
	// Do NOT clear segments: valid entries may still be present.
}
