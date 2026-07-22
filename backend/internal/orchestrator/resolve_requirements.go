package orchestrator

// ResolveRequirementsCtx carries the runtime inputs that
// ResolveRequirements uses to derive a node's ResourceRequirement slice
// dynamically. This mirrors the 260720 TS resolveRequirements(ctx)
// function which based slot requirements on config flags (isVideo,
// downloadCover) and the retry count.
type ResolveRequirementsCtx struct {
	Definition DagNodeDefinition
	RetryCount int
}

// ResolveRequirements derives the ResourceRequirement slice for a node
// based on its config and retry context. When the definition already
// carries a non-empty ResourceRequirements slice, it is returned as-is
// (callers may have precomputed requirements). Otherwise the function
// derives requirements from config flags:
//
//   - config.isVideo true ??[{download, 1, "completed"}] (video download slot)
//   - phase download ??[{download, 1, "completed"}]
//   - phase scrape ??[{scraping, 1, "completed"}]
//   - phase finalize ??no slots (CPU-bound, no I/O concurrency limit)
//
// Retry influence: when RetryCount > 0 the priority is implicitly
// lowered (the caller reads Definition.Priority; this function does not
// mutate it) and a single slot is still required. This keeps retrying
// nodes from starving new submissions because both compete for the same
// pool.
//
// This is a pure function ??it does not mutate the definition.
func ResolveRequirements(ctx ResolveRequirementsCtx) []ResourceRequirement {
	if len(ctx.Definition.ResourceRequirements) > 0 {
		out := make([]ResourceRequirement, len(ctx.Definition.ResourceRequirements))
		copy(out, ctx.Definition.ResourceRequirements)
		return out
	}

	cfg := ctx.Definition.Config
	isVideo, _ := cfg["isVideo"].(bool)

	switch ctx.Definition.Phase {
	case PhaseDownload:
		// Downloads always need a download slot. Video downloads are
		// heavier but still use one slot; the SlotPool's per-type max
		// bounds total concurrency.
		_ = isVideo // acknowledged; single download slot either way
		return []ResourceRequirement{{SlotType: "download", Count: 1, HoldUntil: "completed"}}
	case PhaseScrape:
		return []ResourceRequirement{{SlotType: "scraping", Count: 1, HoldUntil: "completed"}}
	case PhaseFinalize:
		// Finalize (extract/archive) is CPU+disk bound and does not need
		// a network slot. Return empty so the scheduler does not block
		// on the scraping/download pools.
		return nil
	default:
		return nil
	}
}
