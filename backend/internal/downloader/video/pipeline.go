package video

import (
	"context"
	"fmt"
	"sync"

	"backend/internal/infra"
)

var pipelineLogger = infra.NewLogger("Pipeline")

// PipelineData carries data through the pipeline.
type PipelineData struct {
	// InputDir input directory (segment files live here)
	InputDir string
	// OutputPath output file path
	OutputPath string
	// Segments segment info
	Segments []M3U8Segment
	// Metadata resolution/bitrate etc.
	Metadata map[string]any
	// TempFiles temp files to clean up
	TempFiles []string
	// Ctx context, supports cancellation
	Ctx context.Context
	// OnProgress transcode progress callback (0-100 percent), consumed by
	// TranscodeStep. Nil = no progress reporting. Invoked from the ffmpeg
	// output-parsing goroutine — implementations must be lightweight and
	// concurrency-safe.
	OnProgress func(percent float64)
}

// NewPipelineData creates a new PipelineData.
func NewPipelineData(ctx context.Context, inputDir, outputPath string, segments []M3U8Segment) *PipelineData {
	return &PipelineData{
		InputDir:   inputDir,
		OutputPath: outputPath,
		Segments:   segments,
		Metadata:   make(map[string]any),
		Ctx:        ctx,
	}
}

// AddTempFile registers a temp file path.
func (d *PipelineData) AddTempFile(path string) {
	d.TempFiles = append(d.TempFiles, path)
}

// Cleanup removes registered temp files.
func (d *PipelineData) Cleanup() {
	for _, f := range d.TempFiles {
		_ = removeFile(f)
	}
	d.TempFiles = nil
}

// PipelineStep is one processing step in the pipeline.
// Follows cat-catch's use(fn, name) design (see design doc §2.5.2).
type PipelineStep interface {
	// Name returns the step name for logs and debugging.
	Name() string
	// Process transforms data and returns the result.
	Process(ctx context.Context, data *PipelineData) (*PipelineData, error)
}

// FuncStep adapts a plain function to a PipelineStep.
type FuncStep struct {
	name string
	fn   func(ctx context.Context, data *PipelineData) (*PipelineData, error)
}

// Name returns the step name.
func (s *FuncStep) Name() string {
	return s.name
}

// Process invokes the wrapped function.
func (s *FuncStep) Process(ctx context.Context, data *PipelineData) (*PipelineData, error) {
	return s.fn(ctx, data)
}

// NewFuncStep creates a function-based step.
func NewFuncStep(name string, fn func(ctx context.Context, data *PipelineData) (*PipelineData, error)) *FuncStep {
	return &FuncStep{name: name, fn: fn}
}

// Pipeline is a processing pipeline.
// Follows cat-catch's use()/removeProcessor() pattern.
type Pipeline struct {
	steps []PipelineStep
	mu    sync.RWMutex
}

// NewPipeline creates a new pipeline.
func NewPipeline() *Pipeline {
	return &Pipeline{}
}

// Use appends a step (chainable).
// Follows cat-catch's downloader.use(fn, name).
func (p *Pipeline) Use(step PipelineStep) *Pipeline {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.steps = append(p.steps, step)
	return p
}

// Remove drops the step with the given name.
// Follows cat-catch's removeProcessor(name).
func (p *Pipeline) Remove(name string) *Pipeline {
	p.mu.Lock()
	defer p.mu.Unlock()

	filtered := make([]PipelineStep, 0, len(p.steps))
	for _, step := range p.steps {
		if step.Name() != name {
			filtered = append(filtered, step)
		}
	}
	p.steps = filtered
	return p
}

// Has reports whether a step with the given name exists.
func (p *Pipeline) Has(name string) bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	for _, step := range p.steps {
		if step.Name() == name {
			return true
		}
	}
	return false
}

// Steps returns the names of all steps.
func (p *Pipeline) Steps() []string {
	p.mu.RLock()
	defer p.mu.RUnlock()

	names := make([]string, len(p.steps))
	for i, step := range p.steps {
		names[i] = step.Name()
	}
	return names
}

// Execute runs the pipeline.
func (p *Pipeline) Execute(ctx context.Context, data *PipelineData) (*PipelineData, error) {
	p.mu.RLock()
	steps := make([]PipelineStep, len(p.steps))
	copy(steps, p.steps)
	p.mu.RUnlock()

	if data == nil {
		return nil, fmt.Errorf("pipeline data is nil")
	}
	if data.Ctx == nil {
		data.Ctx = ctx
	}

	var err error
	for _, step := range steps {
		select {
		case <-ctx.Done():
			return data, ctx.Err()
		default:
		}

		pipelineLogger.Info("Executing pipeline step",
			infra.LogContext{Extra: map[string]any{
				"step":   step.Name(),
				"input":  data.InputDir,
				"output": data.OutputPath,
			}})

		data, err = step.Process(ctx, data)
		if err != nil {
			pipelineLogger.Error("Pipeline step failed",
				infra.LogContext{Extra: map[string]any{
					"step":  step.Name(),
					"error": err.Error(),
				}})
			return data, fmt.Errorf("step %q failed: %w", step.Name(), err)
		}
	}

	return data, nil
}

// ExecuteWithCleanup runs the pipeline and cleans up temp files.
func (p *Pipeline) ExecuteWithCleanup(ctx context.Context, data *PipelineData) (*PipelineData, error) {
	defer data.Cleanup()
	return p.Execute(ctx, data)
}

// ============================================================
// Built-in steps
// ============================================================

// ConcatStep produces the segment concat list.
type ConcatStep struct{}

// Name returns the step name.
func (s *ConcatStep) Name() string {
	return "concat"
}

// Process generates the concat.txt file.
func (s *ConcatStep) Process(ctx context.Context, data *PipelineData) (*PipelineData, error) {
	if len(data.Segments) == 0 {
		return data, fmt.Errorf("no segments to concat")
	}

	// Should reuse the existing MergeSegments logic to generate concat.txt;
	// simplified for now.
	return data, nil
}

// TranscodeStep runs the FFmpeg transcode.
type TranscodeStep struct {
	UseGPU       bool
	ForceGPUType string
	EncoderArgs  []string // custom encoder args
}

// Name returns the step name.
func (s *TranscodeStep) Name() string {
	return "transcode"
}

// Process runs the FFmpeg transcode.
func (s *TranscodeStep) Process(ctx context.Context, data *PipelineData) (*PipelineData, error) {
	opts := TranscodeOptions{
		UseGPU:       s.UseGPU,
		ForceGPUType: s.ForceGPUType,
		OnProgress:   data.OnProgress,
	}

	if len(s.EncoderArgs) > 0 {
		// TODO: support custom encoder args
		pipelineLogger.Warn("Custom encoder args not yet supported, using defaults",
			infra.LogContext{Extra: map[string]any{
				"args": s.EncoderArgs,
			}})
	}

	// The segment manifest is the authoritative transcode input set —
	// derived from the playlist, never from a directory scan, so stray .ts
	// files (stale merge outputs, foreign-variant residue) are excluded.
	manifest := SegmentManifest(data.Segments)

	if err := TranscodeTSWithFallback(ctx, data.InputDir, data.OutputPath, manifest, opts); err != nil {
		return data, fmt.Errorf("transcode failed: %w", err)
	}

	return data, nil
}

// WatermarkStep overlays a watermark image (optional).
type WatermarkStep struct {
	ImagePath string
	Position  string  // "top-left", "top-right", "bottom-left", "bottom-right"
	Opacity   float64 // 0.0 - 1.0
}

// Name returns the step name.
func (s *WatermarkStep) Name() string {
	return "watermark"
}

// Process applies the watermark.
func (s *WatermarkStep) Process(ctx context.Context, data *PipelineData) (*PipelineData, error) {
	if s.ImagePath == "" {
		pipelineLogger.Warn("Watermark step skipped: no image path", nil)
		return data, nil
	}

	// TODO: implement watermarking
	pipelineLogger.Info("Watermark step (placeholder)",
		infra.LogContext{Extra: map[string]any{
			"image": s.ImagePath,
			"position": s.Position,
		}})

	return data, nil
}

// MetadataStep writes metadata.
type MetadataStep struct {
	Title   string
	Artists []string
	Tags    []string
}

// Name returns the step name.
func (s *MetadataStep) Name() string {
	return "metadata"
}

// Process writes metadata into PipelineData.Metadata.
func (s *MetadataStep) Process(ctx context.Context, data *PipelineData) (*PipelineData, error) {
	if s.Title != "" {
		data.Metadata["title"] = s.Title
	}
	if len(s.Artists) > 0 {
		data.Metadata["artists"] = s.Artists
	}
	if len(s.Tags) > 0 {
		data.Metadata["tags"] = s.Tags
	}

	// TODO: actually write MP4 metadata
	return data, nil
}

// ============================================================
// Prebuilt pipeline factories
// ============================================================

// NewDefaultPipeline creates the default transcode pipeline (concat -> transcode).
func NewDefaultPipeline(useGPU bool, forceGPUType string) *Pipeline {
	return NewPipeline().
		Use(&ConcatStep{}).
		Use(&TranscodeStep{
			UseGPU:       useGPU,
			ForceGPUType: forceGPUType,
		})
}

// NewFullPipeline creates the full transcode pipeline (concat -> transcode -> metadata).
func NewFullPipeline(useGPU bool, forceGPUType string, title string, artists []string) *Pipeline {
	return NewPipeline().
		Use(&ConcatStep{}).
		Use(&TranscodeStep{
			UseGPU:       useGPU,
			ForceGPUType: forceGPUType,
		}).
		Use(&MetadataStep{
			Title:   title,
			Artists: artists,
		})
}

// NewWatermarkPipeline creates a transcode pipeline with watermarking.
func NewWatermarkPipeline(useGPU bool, forceGPUType string, watermarkImage string) *Pipeline {
	return NewPipeline().
		Use(&ConcatStep{}).
		Use(&TranscodeStep{
			UseGPU:       useGPU,
			ForceGPUType: forceGPUType,
		}).
		Use(&WatermarkStep{
			ImagePath: watermarkImage,
			Position:  "bottom-right",
			Opacity:   0.5,
		})
}

// removeFile deletes a file, ignoring errors.
func removeFile(path string) error {
	return nil // stub: should call os.Remove and ignore not-exist errors
}
