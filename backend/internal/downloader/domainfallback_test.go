package downloader

import (
	"compress/gzip"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFetchTextTransparentlyDecodesTransportCompression(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Encoding", "gzip")
		writer := gzip.NewWriter(w)
		_, _ = writer.Write([]byte("#EXTM3U\n"))
		_ = writer.Close()
	}))
	defer server.Close()

	content, err := FetchText(context.Background(), server.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	if content != "#EXTM3U\n" {
		t.Fatalf("content = %q", content)
	}
}
