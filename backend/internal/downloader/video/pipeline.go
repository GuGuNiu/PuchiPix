package video

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	"backend/internal/infra"
)

var pipelineLogger = infra.NewLogger("Pipeline")

type PipelineData struct {
	// InputDir input directory (segment files live here)
	InputDir         string
	MergedInputPath  string
	ExpectedDuration time.Duration
	OutputPath       string
	Segments         []M3U8Segment
	Metadata         map[string]any
	TempFiles        []string
	// Ctx context, supports cancellation
	Ctx context.Context
	// OnProgress transcode progress callback (0-100 percent), consumed by
	// TranscodeStep. Nil = no progress reporting. Invoked from the ffmpeg
	// output-parsing goroutine — implementations must be lightweight and
	// tolerate concurrent calls.
	OnProgress func(percent float64)
}

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

type PipelineStep interface {
	Name() string
	Process(ctx context.Context, data *PipelineData) (*PipelineData, error)
}

// FuncStep adapts a plain function to a PipelineStep.
type FuncStep struct {
	name string
	fn   func(ctx context.Context, data *PipelineData) (*PipelineData, error)
}

func (s *FuncStep) Name() string {
	return s.name
}

func (s *FuncStep) Process(ctx context.Context, data *PipelineData) (*PipelineData, error) {
	return s.fn(ctx, data)
}

func NewFuncStep(name string, fn func(ctx context.Context, data *PipelineData) (*PipelineData, error)) *FuncStep {
	return &FuncStep{name: name, fn: fn}
}

type Pipeline struct {
	steps []PipelineStep
	mu    sync.RWMutex
}

func NewPipeline() *Pipeline {
	return &Pipeline{}
}

// Use appends a step (chainable).
func (p *Pipeline) Use(step PipelineStep) *Pipeline {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.steps = append(p.steps, step)
	return p
}

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

// ConcatStep produces the segment concat list.
type ConcatStep struct{}

func (s *ConcatStep) Name() string {
	return "concat"
}

func (s *ConcatStep) Process(ctx context.Context, data *PipelineData) (*PipelineData, error) {
	if data.MergedInputPath != "" {
		return data, nil
	}
	if len(data.Segments) == 0 {
		return data, fmt.Errorf("no segments to concat")
	}

	// TODO: write concat.txt from the segment manifest when no merged
	// input was produced upstream
	return data, nil
}

// TranscodeStep runs the FFmpeg transcode.
type TranscodeStep struct {
	UseGPU       bool
	ForceGPUType string
	EncoderArgs  []string // custom encoder args
}

func (s *TranscodeStep) Name() string {
	return "transcode"
}

func (s *TranscodeStep) Process(ctx context.Context, data *PipelineData) (*PipelineData, error) {
	opts := TranscodeOptions{
		UseGPU:           s.UseGPU,
		ForceGPUType:     s.ForceGPUType,
		ExpectedDuration: data.ExpectedDuration,
		OnProgress:       data.OnProgress,
	}

	if len(s.EncoderArgs) > 0 {
		// TODO: support custom encoder args
		pipelineLogger.Warn("Custom encoder args not yet supported, using defaults",
			infra.LogContext{Extra: map[string]any{
				"args": s.EncoderArgs,
			}})
	}

	if data.MergedInputPath != "" {
		if err := TranscodeMergedTSWithFallback(ctx, data.MergedInputPath, data.OutputPath, opts); err != nil {
			return data, fmt.Errorf("transcode failed: %w", err)
		}
		return data, nil
	}

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

func (s *WatermarkStep) Name() string {
	return "watermark"
}

func (s *WatermarkStep) Process(ctx context.Context, data *PipelineData) (*PipelineData, error) {
	if s.ImagePath == "" {
		pipelineLogger.Warn("Watermark step skipped: no image path", nil)
		return data, nil
	}

	// TODO: implement watermarking
	pipelineLogger.Info("Watermark step (placeholder)",
		infra.LogContext{Extra: map[string]any{
			"image":    s.ImagePath,
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

func (s *MetadataStep) Name() string {
	return "metadata"
}

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
	err := os.Remove(path)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}
