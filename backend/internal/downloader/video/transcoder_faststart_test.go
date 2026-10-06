package video

import (
	"testing"
)

func argsContain(args []string, pair ...string) bool {
	for i := 0; i+len(pair) <= len(args); i++ {
		match := true
		for j, want := range pair {
			if args[i+j] != want {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}

func argsIndex(args []string, target string) int {
	for i, a := range args {
		if a == target {
			return i
		}
	}
	return -1
}

func TestBuildCopyArgsEnablesFaststart(t *testing.T) {
	for _, concatInput := range []bool{false, true} {
		args := buildCopyArgs("in.ts", "out.mp4", concatInput)

		if !argsContain(args, "-movflags", "+faststart") {
			t.Fatalf("concatInput=%v: missing -movflags +faststart, got %v", concatInput, args)
		}

		ffmpegIdx := argsIndex(args, "-y")
		if ffmpegIdx == -1 {
			t.Fatalf("concatInput=%v: missing -y terminator, got %v", concatInput, args)
		}

		movIdx := argsIndex(args, "-movflags")
		if movIdx > ffmpegIdx {
			t.Fatalf("concatInput=%v: -movflags must precede the output filename", concatInput)
		}
		if movIdx < argsIndex(args, "-i") {
			t.Fatalf("concatInput=%v: -movflags is an output option and must follow -i", concatInput)
		}

		outIdx := argsIndex(args, "out.mp4")
		if outIdx < ffmpegIdx {
			t.Fatalf("concatInput=%v: output filename must be the final argument, got %v", concatInput, args)
		}
	}
}

func TestBuildHWArgsEnablesFaststart(t *testing.T) {
	for _, gpuType := range []GPUType{GPUTypeNVENC, GPUTypeQSV, GPUTypeVAAPI, GPUTypeAMF, GPUTypeVideotoolbox} {
		for _, concatInput := range []bool{false, true} {
			args := buildForcedHWArgsForInput(gpuType, "in.ts", "out.mp4", concatInput)

			if !argsContain(args, "-movflags", "+faststart") {
				t.Fatalf("gpu=%v concatInput=%v: missing -movflags +faststart, got %v", gpuType, concatInput, args)
			}
			if argsIndex(args, "-movflags") < argsIndex(args, "-i") {
				t.Fatalf("gpu=%v concatInput=%v: -movflags must follow -i", gpuType, concatInput)
			}
			if argsIndex(args, "-y") < argsIndex(args, "-movflags") {
				t.Fatalf("gpu=%v concatInput=%v: -movflags must precede output filename", gpuType, concatInput)
			}
		}
	}
}

func TestFaststartAppliedOnEveryTranscodePath(t *testing.T) {
	paths := map[string][]string{
		"copy_concat": buildCopyArgs("in.ts", "out.mp4", true),
		"copy_single": buildCopyArgs("in.ts", "out.mp4", false),
		"hw_nvenc":    buildForcedHWArgsForInput(GPUTypeNVENC, "in.ts", "out.mp4", true),
		"hw_qsv":      buildForcedHWArgsForInput(GPUTypeQSV, "in.ts", "out.mp4", false),
		"hw_vaapi":    buildForcedHWArgsForInput(GPUTypeVAAPI, "in.ts", "out.mp4", true),
		"hw_amf":      buildForcedHWArgsForInput(GPUTypeAMF, "in.ts", "out.mp4", false),
		"hw_vtbox":    buildForcedHWArgsForInput(GPUTypeVideotoolbox, "in.ts", "out.mp4", true),
	}
	for name, args := range paths {
		if !argsContain(args, "-movflags", "+faststart") {
			t.Fatalf("%s: missing -movflags +faststart, got %v", name, args)
		}
	}
}
