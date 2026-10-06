package downloader

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"backend/internal/infra"
)

// memReader is a fixed-payload io.ReadSeeker so http.ServeContent can
// answer Range requests, exercising the multi-thread download path.
type memReader struct {
	data   []byte
	offset int64
}

func (m *memReader) Read(p []byte) (int, error) {
	if m.offset >= int64(len(m.data)) {
		return 0, io.EOF
	}
	n := copy(p, m.data[m.offset:])
	m.offset += int64(n)
	return n, nil
}

func (m *memReader) Seek(offset int64, whence int) (int64, error) {
	switch whence {
	case io.SeekStart:
		m.offset = offset
	case io.SeekCurrent:
		m.offset += offset
	case io.SeekEnd:
		m.offset = int64(len(m.data)) + offset
	}
	return m.offset, nil
}

// servePayload spins up a test server serving len(payload) bytes with
// Range support so both download paths can be exercised against it.
func servePayload(t *testing.T, payload []byte) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.ServeContent(w, r, "payload.bin", time.Time{}, &memReader{data: payload})
	}))
	t.Cleanup(srv.Close)
	return srv
}

func assertCounted(t *testing.T, label string, netBefore, diskBefore uint64, payloadLen int) {
	t.Helper()
	if net := infra.NetBytesTotal() - netBefore; net < uint64(payloadLen) {
		t.Errorf("%s: network counter delta %d < payload %d", label, net, payloadLen)
	}
	if disk := infra.DiskBytesTotal() - diskBefore; disk < uint64(payloadLen) {
		t.Errorf("%s: disk counter delta %d < payload %d", label, disk, payloadLen)
	}
}

func TestDownloadSingleThreadCountsThroughput(t *testing.T) {
	payload := make([]byte, 512*1024) // below the 1 MB multi-thread threshold
	for i := range payload {
		payload[i] = byte(i)
	}
	srv := servePayload(t, payload)

	netBefore, diskBefore := infra.NetBytesTotal(), infra.DiskBytesTotal()
	dest := filepath.Join(t.TempDir(), "single.bin")
	res := DownloadFile(context.Background(), srv.URL, dest, &DownloadOptions{})
	if res == nil || !res.Success {
		t.Fatalf("single-thread download failed: %+v", res)
	}
	assertCounted(t, "single-thread", netBefore, diskBefore, len(payload))
}

func TestDownloadMultiThreadCountsThroughput(t *testing.T) {
	payload := make([]byte, 2*1024*1024) // above the 1 MB threshold
	for i := range payload {
		payload[i] = byte(i * 7)
	}
	srv := servePayload(t, payload)

	netBefore, diskBefore := infra.NetBytesTotal(), infra.DiskBytesTotal()
	dest := filepath.Join(t.TempDir(), "multi.bin")
	res := DownloadFile(context.Background(), srv.URL, dest, &DownloadOptions{
		MultiThread: true,
		Concurrency: 4,
		MinFileSize: 1 << 20,
	})
	if res == nil || !res.Success {
		t.Fatalf("multi-thread download failed: %+v", res)
	}
	assertCounted(t, "multi-thread", netBefore, diskBefore, len(payload))
}
