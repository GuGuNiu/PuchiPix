#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const backend = resolve(repoRoot, "backend");
const frontend = resolve(repoRoot, "frontend");
const outDir = resolve(repoRoot, "dist-desktop");

const skipFrontend = process.argv.includes("--skip-frontend");

function run(command, args, cwd) {
  console.log(`[build-desktop] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`[build-desktop] failed: ${command} exited with ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

// A probe failure is not conclusive: under some sandboxes spawning an
// external binary fails with EBUSY even though the binary is present. Only a
// probe that actually reports success counts as "missing"; an inconclusive
// probe lets the real build attempt decide.
function missing(cmd, probeArgs) {
  const probe = spawnSync(cmd, probeArgs, {
    shell: process.platform === "win32",
    encoding: "utf8",
  });
  if (probe.error) {
    console.warn(
      `[build-desktop] could not probe ${cmd} (${probe.error.code || probe.error.message}); assuming present`,
    );
    return false;
  }
  return probe.status !== 0;
}

if (!skipFrontend) {
  if (missing("pnpm", ["--version"])) {
    console.error("[build-desktop] pnpm not found in PATH");
    process.exit(1);
  }
  run("pnpm", ["build"], frontend);
}

run(process.execPath, [resolve(repoRoot, "scripts", "sync-dist.mjs"), "--force"], repoRoot);

if (missing("go", ["version"])) {
  console.error("[build-desktop] go not found in PATH");
  process.exit(1);
}

// The `production` build tag is mandatory: without it Wails compiles a stub
// CreateApp that shows an error dialog and returns immediately, so the binary
// builds cleanly but never opens a window.
run(
  "go",
  ["build", "-tags", "production", "-trimpath", "-ldflags", "-s -w", "-o", resolve(outDir, "PuchiPix.exe"), "./cmd/desktop"],
  backend,
);

const exe = resolve(outDir, "PuchiPix.exe");
if (!existsSync(exe)) {
  console.error("[build-desktop] expected binary missing:", exe);
  process.exit(1);
}
console.log(`[build-desktop] built ${exe}`);