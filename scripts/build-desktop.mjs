#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const backend = resolve(repoRoot, "backend");
const frontend = resolve(repoRoot, "frontend");
const outDir = resolve(repoRoot, "dist-desktop");

const skipFrontend = process.argv.includes("--skip-frontend");

function run(command, args, cwd, options = {}) {
  const useShell = options.shell ?? process.platform === "win32";
  const tolerant = options.tolerant ?? false;
  console.log(`[build-desktop] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: useShell,
  });
  if (result.status === 0) {
    return;
  }
  const message = `${command} exited with ${result.status}`;
  if (tolerant) {
    const error = new Error(message);
    console.warn(`[build-desktop] ${message}`);
    throw error;
  }
  console.error(`[build-desktop] failed: ${message}`);
  process.exit(result.status ?? 1);
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

run(process.execPath, [resolve(repoRoot, "scripts", "build-resources.mjs")], repoRoot);

// The `production` build tag is mandatory: without it Wails compiles a stub
// CreateApp that shows an error dialog and returns immediately, so the binary
// builds cleanly but never opens a window.
//
// shell:false keeps argv intact; through a shell the "-s -w" ldflags value
// would be re-split and go would reject "-w" as an unknown flag.
run(
  "go",
  ["build", "-tags", "production", "-trimpath", "-ldflags", "-s -w", "-o", resolve(outDir, "PuchiPix.exe"), "./cmd/desktop"],
  backend,
  { shell: false },
);

const exe = resolve(outDir, "PuchiPix.exe");
if (!existsSync(exe)) {
  console.error("[build-desktop] expected binary missing:", exe);
  process.exit(1);
}
console.log(`[build-desktop] built ${exe}`);

// The installer is optional locally: NSIS is not always installed, and a
// missing makensis must not invalidate a perfectly good exe. Pass
// --require-installer in CI, where a broken .nsi has to fail the build.
const requireInstaller = process.argv.includes("--require-installer");

if (missing("makensis", ["-VERSION"])) {
  const hint = "[build-desktop] install NSIS to produce the setup executable";
  if (requireInstaller) {
    console.error("[build-desktop] makensis not found but installer is required");
    console.error(hint);
    process.exit(1);
  }
  console.log("[build-desktop] makensis not found, skipping installer");
  console.log(hint);
} else {
  const version = JSON.parse(
    readFileSync(resolve(repoRoot, "frontend", "package.json"), "utf8"),
  ).version;
  const installer = resolve(outDir, `PuchiPix-${version}-setup.exe`);
  try {
    run(
      "makensis",
      [
        "/DAPP_VERSION=" + version,
        resolve(repoRoot, "build", "windows", "installer.nsi"),
      ],
      resolve(repoRoot, "build", "windows"),
      { tolerant: !requireInstaller },
    );
  } catch {
    if (requireInstaller) {
      console.error("[build-desktop] installer build failed");
      process.exit(1);
    }
    console.warn("[build-desktop] continuing without installer");
  }
  if (existsSync(installer)) {
    console.log(`[build-desktop] built ${installer}`);
  } else if (requireInstaller) {
    console.error("[build-desktop] expected installer missing:", installer);
    process.exit(1);
  } else {
    console.warn("[build-desktop] installer not produced");
  }
}