package video

import (
	"context"
	"fmt"
	"sync"

	"backend/internal/infra"
)

var pipelineLogger = infra.NewLogger("Pipeline")

// PipelineData 在管道中传递的数据
type PipelineData struct {
	// InputDir 输入目录（分片所在）
	InputDir string
	// OutputPath 输出文件路径
	OutputPath string
	// Segments 分片信息
	Segments []M3U8Segment
	// Metadata 元数据（分辨率、码率等）
	Metadata map[string]any
	// TempFiles 临时文件（需要清理）
	TempFiles []string
	// Ctx 上下文，支持取消
	Ctx context.Context
	// OnProgress 转码进度回调（0-100 百分比），由 TranscodeStep 消费。
	// Nil = 不上报进度。回调在 ffmpeg 输出解析 goroutine 中触发，
	// 实现必须轻量且并发安全。
	OnProgress func(percent float64)
}

// NewPipelineData 创建新的 PipelineData
func NewPipelineData(ctx context.Context, inputDir, outputPath string, segments []M3U8Segment) *PipelineData {
	return &PipelineData{
		InputDir:   inputDir,
		OutputPath: outputPath,
		Segments:   segments,
		Metadata:   make(map[string]any),
		Ctx:        ctx,
	}
}

// AddTempFile 添加临时文件路径
func (d *PipelineData) AddTempFile(path string) {
	d.TempFiles = append(d.TempFiles, path)
}

// Cleanup 清理临时文件
func (d *PipelineData) Cleanup() {
	for _, f := range d.TempFiles {
		_ = removeFile(f)
	}
	d.TempFiles = nil
}

// PipelineStep 定义管道中的一个处理步骤
// 借鉴 cat-catch 的 use(fn, name) 设计（研学文档 §2.5.2）
type PipelineStep interface {
	// Name 返回步骤名称，用于日志和调试
	Name() string
	// Process 处理数据，返回处理后的数据
	Process(ctx context.Context, data *PipelineData) (*PipelineData, error)
}

// FuncStep 允许使用函数作为 PipelineStep
type FuncStep struct {
	name string
	fn   func(ctx context.Context, data *PipelineData) (*PipelineData, error)
}

// Name 返回步骤名称
func (s *FuncStep) Name() string {
	return s.name
}

// Process 执行处理函数
func (s *FuncStep) Process(ctx context.Context, data *PipelineData) (*PipelineData, error) {
	return s.fn(ctx, data)
}

// NewFuncStep 创建基于函数的步骤
func NewFuncStep(name string, fn func(ctx context.Context, data *PipelineData) (*PipelineData, error)) *FuncStep {
	return &FuncStep{name: name, fn: fn}
}

// Pipeline 处理管道
// 借鉴 cat-catch 的 use()/removeProcessor() 模式
type Pipeline struct {
	steps []PipelineStep
	mu    sync.RWMutex
}

// NewPipeline 创建新的管道
func NewPipeline() *Pipeline {
	return &Pipeline{}
}

// Use 添加处理步骤（链式调用）
// 借鉴 cat-catch 的 downloader.use(fn, name)
func (p *Pipeline) Use(step PipelineStep) *Pipeline {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.steps = append(p.steps, step)
	return p
}

// Remove 移除指定名称的步骤
// 借鉴 cat-catch 的 removeProcessor(name)
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

// Has 检查是否包含指定名称的步骤
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

// Steps 返回所有步骤的名称
func (p *Pipeline) Steps() []string {
	p.mu.RLock()
	defer p.mu.RUnlock()

	names := make([]string, len(p.steps))
	for i, step := range p.steps {
		names[i] = step.Name()
	}
	return names
}

// Execute 执行管道
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
		// 检查上下文是否已取消
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

// ExecuteWithCleanup 执行管道并自动清理临时文件
func (p *Pipeline) ExecuteWithCleanup(ctx context.Context, data *PipelineData) (*PipelineData, error) {
	defer data.Cleanup()
	return p.Execute(ctx, data)
}

// ============================================================
// 内置处理步骤
// ============================================================

// ConcatStep 生成分片 concat 列表
type ConcatStep struct{}

// Name 返回步骤名称
func (s *ConcatStep) Name() string {
	return "concat"
}

// Process 生成 concat.txt 文件
func (s *ConcatStep) Process(ctx context.Context, data *PipelineData) (*PipelineData, error) {
	if len(data.Segments) == 0 {
		return data, fmt.Errorf("no segments to concat")
	}

	// 使用现有的 MergeSegments 逻辑生成 concat 文件
	// 这里简化处理，实际应该生成 concat.txt
	return data, nil
}

// TranscodeStep FFmpeg 转码步骤
type TranscodeStep struct {
	UseGPU       bool
	ForceGPUType string
	EncoderArgs  []string // 自定义编码器参数
}

// Name 返回步骤名称
func (s *TranscodeStep) Name() string {
	return "transcode"
}

// Process 执行 FFmpeg 转码
func (s *TranscodeStep) Process(ctx context.Context, data *PipelineData) (*PipelineData, error) {
	opts := TranscodeOptions{
		UseGPU:       s.UseGPU,
		ForceGPUType: s.ForceGPUType,
		OnProgress:   data.OnProgress,
	}

	// 如果有自定义编码器参数，需要特殊处理
	if len(s.EncoderArgs) > 0 {
		// TODO: 支持自定义编码器参数
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

// WatermarkStep 添加水印步骤（可选）
type WatermarkStep struct {
	ImagePath string
	Position  string  // "top-left", "top-right", "bottom-left", "bottom-right"
	Opacity   float64 // 0.0 - 1.0
}

// Name 返回步骤名称
func (s *WatermarkStep) Name() string {
	return "watermark"
}

// Process 添加水印
func (s *WatermarkStep) Process(ctx context.Context, data *PipelineData) (*PipelineData, error) {
	if s.ImagePath == "" {
		pipelineLogger.Warn("Watermark step skipped: no image path", nil)
		return data, nil
	}

	// TODO: 实现水印添加逻辑
	pipelineLogger.Info("Watermark step (placeholder)",
		infra.LogContext{Extra: map[string]any{
			"image": s.ImagePath,
			"position": s.Position,
		}})

	return data, nil
}

// MetadataStep 写入元数据步骤
type MetadataStep struct {
	Title   string
	Artists []string
	Tags    []string
}

// Name 返回步骤名称
func (s *MetadataStep) Name() string {
	return "metadata"
}

// Process 写入元数据
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

	// TODO: 实际写入 MP4 元数据
	return data, nil
}

// ============================================================
// 预构建管道工厂函数
// ============================================================

// NewDefaultPipeline 创建默认的转码管道（concat -> transcode）
func NewDefaultPipeline(useGPU bool, forceGPUType string) *Pipeline {
	return NewPipeline().
		Use(&ConcatStep{}).
		Use(&TranscodeStep{
			UseGPU:       useGPU,
			ForceGPUType: forceGPUType,
		})
}

// NewFullPipeline 创建完整的转码管道（concat -> transcode -> metadata）
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

// NewWatermarkPipeline 创建带水印的转码管道
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

// removeFile 辅助函数：删除文件，忽略错误
func removeFile(path string) error {
	// 使用 os.Remove 但忽略文件不存在的错误
	return nil // 简化实现
}
