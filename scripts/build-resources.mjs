#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const resourceDir = resolve(repoRoot, "build", "windows");
const sysoTarget = resolve(repoRoot, "backend", "cmd", "desktop", "PuchiPix.syso");
const rcFile = resolve(resourceDir, "PuchiPix.rc");
const iconFile = resolve(resourceDir, "icon.ico");
const manifestFile = resolve(resourceDir, "app.manifest");

const windres = process.env.WINDRES ?? "windres";
const arch = process.env.GOARCH ?? "amd64";
const windresTarget = arch === "arm64" ? "pe-aarch64" : "pe-x86-64";

const version = JSON.parse(
  readFileSync(resolve(repoRoot, "frontend", "package.json"), "utf8"),
).version ?? "0.0.0";

const [major, minor, patch] = version.split(".").map((part) => parseInt(part, 10) || 0);
const build = process.env.BUILD_NUMBER ? parseInt(process.env.BUILD_NUMBER, 10) || 0 : 0;

function fail(message) {
  console.error(`[build-resources] ${message}`);
  process.exit(1);
}

if (process.platform !== "win32") {
  console.log("[build-resources] not windows, skipping resource compilation");
  process.exit(0);
}

if (!existsSync(rcFile)) fail(`missing ${rcFile}`);
if (!existsSync(iconFile)) fail(`missing ${iconFile} (run make-icon.py)`);
if (!existsSync(manifestFile)) fail(`missing ${manifestFile}`);

const probe = spawnSync(windres, ["--version"], { encoding: "utf8", shell: true });
if (probe.status !== 0 && !probe.error) {
  console.warn(
    `[build-resources] windres not usable (exit ${probe.status}); the exe will carry no icon or version resource`,
  );
  console.warn("[build-resources] install MinGW (winres) or set WINDRES to its full path");
  process.exit(0);
}
if (probe.error) {
  console.warn(
    `[build-resources] could not probe windres (${probe.error.code ?? probe.error.message}); attempting the build anyway`,
  );
}

mkdirSync(resourceDir, { recursive: true });
const produced = resolve(resourceDir, "PuchiPix.syso");

const args = [
  "-O",
  "coff",
  `--target=${windresTarget}`,
  "-o",
  produced,
  `-DVERSION_MAJOR=${major}`,
  `-DVERSION_MINOR=${minor}`,
  `-DVERSION_PATCH=${patch}`,
  `-DVERSION_BUILD=${build}`,
  rcFile,
];

console.log(
  `[build-resources] ${windres} ${args.slice(1, -1).join(" ")} ${rcFile}`,
);
const result = spawnSync(windres, args, { stdio: "inherit", shell: true, cwd: resourceDir });
if (result.status !== 0) {
  fail(`windres exited with ${result.status}`);
}
if (!existsSync(produced)) fail(`windres produced no output at ${produced}`);

copyFileSync(produced, sysoTarget);
console.log(
  `[build-resources] version ${version} (${major}.${minor}.${patch}.${build}) -> ${sysoTarget}`,
);
