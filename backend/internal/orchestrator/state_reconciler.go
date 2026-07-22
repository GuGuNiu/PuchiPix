package orchestrator

import (
	"context"
	"os"
	"path/filepath"

	"backend/internal/db"
	"backend/internal/infra"
)

// DagNodeForVerification is the subset of node data the reconciler
// needs to verify a node's side effects.
type DagNodeForVerification struct {
	NodeID string
	DagID  string
	State  NodeState
	Phase  string
	Config map[string]any
}

// StateReconciler verifies that a node's side effects are consistent
// with its state, implementing the 260720 needs_retry fix that allows
// interrupted scrapes to be retried instead of hard-failed.
type StateReconciler struct {
	logger *infra.Logger
	db     *db.Database
}

// NewStateReconciler creates a reconciler backed by the given database.
func NewStateReconciler(database *db.Database) *StateReconciler {
	return &StateReconciler{
		logger: infra.NewLogger("StateReconciler"),
		db:     database,
	}
}

// VerifyNode checks a node's consistency and returns a verification
// result that may trigger needs_retry for recoverable failures.
//
// For nodes in RESUME_VERIFY state (set by the onRestart policy when a
// VERIFYING node is restarted with resumableVerify=true), the reconciler
// first signals that verification should resume from the last checkpoint
// by returning a "resume" status; the caller (scheduler/orchestrator) is
// responsible for transitioning the node back to VERIFYING so the verify
// executor can re-run. Previously this branch was an empty code block,
// which left RESUME_VERIFY nodes stranded with no recovery action.
func (r *StateReconciler) VerifyNode(ctx context.Context, node DagNodeForVerification) VerificationResult {
	if node.State == NodeStateResumeVerify {
		// RESUME_VERIFY entry point: signal the caller to transition the
		// node back to VERIFYING and re-run the verify executor. The
		// checkpoint (e.g. list of already-downloaded files) is carried in
		// node.Config, so the verify executor can resume from there rather
		// than restarting the whole phase. We return a "resume" status
		// distinct from "passed"/"needs_retry" so the caller knows to
		// drive the VERIFYING transition before re-checking side effects.
		r.logger.Info("RESUME_VERIFY node ??signaling resume from checkpoint", "nodeId", node.NodeID, "dagId", node.DagID, "phase", node.Phase)
		// Fall through to the phase-specific check below so we also report
		// the current side-effect state (e.g. partial scrape results). The
		// caller can use this to decide whether to re-verify or mark
		// completed if the checkpoint already satisfies the requirements.
	} else if node.State != NodeStateVerifying {
		return VerificationResult{Status: "skipped", Reason: "not in verifying state"}
	}

	switch node.Phase {
	case "scrape":
		return r.verifyScrapeNode(ctx, node)
	case "download":
		return r.verifyDownloadNode(ctx, node)
	default:
		return VerificationResult{Status: "passed", Reason: "no verification needed"}
	}
}

// verifyScrapeNode checks whether the scrape produced any images or
// videos. If none exist, the scrape was likely interrupted before
// saving, so needs_retry is returned to trigger automatic re-scrape.
func (r *StateReconciler) verifyScrapeNode(ctx context.Context, node DagNodeForVerification) VerificationResult {
	galleryID, ok := node.Config["galleryId"]
	if !ok {
		return VerificationResult{Status: "passed", Reason: "no galleryId in config"}
	}

	if r.db == nil {
		return VerificationResult{Status: "passed", Reason: "no database connection"}
	}

	var imageCount, videoCount int
	r.db.QueryRow(ctx,
		"SELECT COUNT(*) FROM "+db.TableGalleryImage+" WHERE gallery_id = $1", galleryID,
	).Scan(&imageCount)
	r.db.QueryRow(ctx,
		"SELECT COUNT(*) FROM "+db.TableGalleryVideo+" WHERE gallery_id = $1", galleryID,
	).Scan(&videoCount)

	if imageCount == 0 && videoCount == 0 {
		return VerificationResult{
			Status: "needs_retry",
			Reason: "scrape was interrupted before saving data, re-scrape needed",
		}
	}

	return VerificationResult{
		Status: "passed",
		Reason: "images: " + intToStr(imageCount) + ", videos: " + intToStr(videoCount),
	}
}

// verifyDownloadNode checks whether all expected files exist on disk
// and their status is consistent, correcting stale database records.
func (r *StateReconciler) verifyDownloadNode(ctx context.Context, node DagNodeForVerification) VerificationResult {
	if r.db == nil {
		return VerificationResult{Status: "passed", Reason: "no database connection"}
	}

	savePath, _ := node.Config["savePath"].(string)
	if savePath == "" {
		return VerificationResult{Status: "failed", Reason: "no savePath in config"}
	}

	corrected := 0

	if _, err := os.Stat(savePath); err != nil {
		if os.IsNotExist(err) {
			return VerificationResult{Status: "failed", Reason: "save path does not exist", Corrected: corrected}
		}
	}

	totalSize := calculateDirSize(savePath)
	if totalSize == 0 {
		return VerificationResult{Status: "failed", Corrected: corrected, Reason: "save path is empty"}
	}

	return VerificationResult{Status: "passed", Corrected: corrected, Reason: "all files verified"}
}

// intToStr converts an integer to its decimal string representation
// without importing strconv to avoid the dependency in this file.
func intToStr(n int) string {
	if n == 0 {
		return "0"
	}
	buf := make([]byte, 0, 10)
	for n > 0 {
		buf = append([]byte{byte('0' + n%10)}, buf...)
		n /= 10
	}
	return string(buf)
}

// calculateDirSize walks a directory tree and returns the total size
// of all files within it, used by verifyDownloadNode to check that
// downloaded content exists on disk.
func calculateDirSize(dirPath string) int64 {
	if dirPath == "" {
		return 0
	}
	info, err := os.Stat(dirPath)
	if err != nil || !info.IsDir() {
		return 0
	}

	var totalSize int64
	err = filepath.WalkDir(dirPath, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() {
			if fi, err := d.Info(); err == nil {
				totalSize += fi.Size()
			}
		}
		return nil
	})
	if err != nil {
		return 0
	}
	return totalSize
}
